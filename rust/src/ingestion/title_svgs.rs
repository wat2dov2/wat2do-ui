//! Keeping events' title drawings (`events.title_svg`) complete.
//!
//! The ingestion agent draws an event's title SVG when it reads the event's
//! post. The API server's worker ([`run`]) draws it the same way, from the
//! event's stored poster and the same rules
//! (`backend/services/ingestion/title_svg_rules.md`), for every featured event
//! to come (one a carousel posts shows its poster's lettering on its featured
//! card soon after) whose drawing is missing, does not spell its title, or
//! would render badly on a card (`title_svg_rendering`), soonest first. Events
//! that are not featured are never drawn again. It writes only `title_svg`.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use chrono::Utc;
use futures_util::{StreamExt, stream};
use regex::{Captures, Regex};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::watch;
use unicode_normalization::UnicodeNormalization;

use super::agent::extension;
use super::title_svg_rendering::rendering_problem;
use crate::api::events::store::featuring_slides;
use crate::claude::{self, Agent, Limited};
use crate::controlbox::INGESTION;
use crate::images::fetch_image;
use crate::ingestion::prompt::TITLE_SVG_RULES;
use crate::launch_agents::claude_code_path;
use crate::revalidation::revalidate_schools;

/// Drawings between refreshes of their schools' event feeds, so a long pass shows as it goes.
const REFRESH_EVERY: usize = 25;
const WORKDIR_PREFIX: &str = "wat2do-title-svg-";
/// The longest SVG the `events_title_svg_shape` check accepts.
const MAX_LENGTH: usize = 20_000;

/// The same shape the database's `events_title_svg_shape` check requires, so a
/// drawing the database would refuse is counted as rejected instead of failing.
static FORBIDDEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<script|<foreignobject|<iframe|<image|javascript:|\son[a-z]+\s*=").unwrap()
});
static OPENS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^<svg[\s>]").unwrap());
static CLOSES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"</svg>\s*$").unwrap());

pub fn is_title_svg(svg: &str) -> bool {
    svg.len() <= MAX_LENGTH
        && OPENS.is_match(svg)
        && CLOSES.is_match(svg)
        && !FORBIDDEN.is_match(svg)
}

/// Short joining words a poster often drops or sets as a symbol.
const JOINING_WORDS: [&str; 22] = [
    "a", "an", "and", "at", "by", "de", "des", "du", "en", "et", "for", "in", "la", "le", "les",
    "of", "on", "the", "to", "vs", "with", "x",
];
static DRAWN_TEXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r">([^<>]*)<").unwrap());
static ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&#x([0-9a-f]+);|&#(\d+);|&([a-z]+);").unwrap());
static WORD_BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\s/:|]+").unwrap());

/// Letters and digits only, lower-cased and without accents, so "B A S K E T" reads as "basket".
fn letters(text: &str) -> String {
    text.nfkd()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect()
}

/// Everything the drawing writes, its text and tspan contents run together.
fn drawn_letters(svg: &str) -> String {
    let text = DRAWN_TEXT
        .captures_iter(svg)
        .map(|content| content[1].to_owned())
        .collect::<Vec<_>>()
        .join(" ");
    let decoded = ENTITY.replace_all(&text, |entity: &Captures| {
        let character = if let Some(hex) = entity.get(1) {
            u32::from_str_radix(hex.as_str(), 16)
                .ok()
                .and_then(char::from_u32)
        } else if let Some(decimal) = entity.get(2) {
            decimal.as_str().parse().ok().and_then(char::from_u32)
        } else {
            match entity[3].to_ascii_lowercase().as_str() {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ => None,
            }
        };
        character.map_or_else(|| entity[0].to_owned(), String::from)
    });
    letters(&decoded)
}

/// Whether a drawing spells every word of its event's title, the check the
/// events page (`titleSvgSpellsTitle` in `frontend/src/features/events/lib/titleSvg.ts`)
/// makes before it shows a drawing in the title's place. A drawing that left a
/// word out (a sponsor set as a logo) or drew other lettering (a "WEEK AHEAD"
/// header) would show the wrong title, so it is drawn again instead.
pub fn spells_title(svg: &str, title: &str) -> bool {
    let drawn = drawn_letters(svg);
    WORD_BREAK
        .split(title)
        .map(letters)
        .filter(|word| word.len() > 1 && !JOINING_WORDS.contains(&word.as_str()))
        .all(|word| drawn.contains(&word))
}

pub(super) struct Waiting {
    pub id: i64,
    title: String,
    poster: String,
}

enum Drawn {
    Svg(String),
    Plain,
    Rejected,
}

/// Keep every featured event to come drawn ([`featured_to_draw`]), `title_svg_lanes` at
/// a time; an event none of whose drawings was kept waits
/// `title_svg_retry_hours` before it is drawn again. Events are looked for
/// every `title_svg_poll_seconds`, and Claude's usage limit pauses the
/// drawings until it lifts.
pub async fn run(db: PgPool, mut stopping: watch::Receiver<bool>) {
    let mut tried: HashMap<i64, Instant> = HashMap::new();
    let mut checked = Checked::default();
    while !*stopping.borrow() {
        let pause = match draw_due(&db, &mut tried, &mut checked, &stopping).await {
            Ok(None) => Duration::from_secs(INGESTION.title_svg_poll_seconds),
            Ok(Some(limited)) => {
                tracing::warn!("Title drawings wait for Claude: {}", limited.message);
                limited
                    .resets_at
                    .and_then(|resets_at| (resets_at - Utc::now()).to_std().ok())
                    .unwrap_or(Duration::from_secs(INGESTION.agent_pause_seconds))
            }
            Err(error) => {
                tracing::error!("Title drawings failed: {error:#}");
                Duration::from_secs(INGESTION.title_svg_poll_seconds)
            }
        };
        let _ = tokio::time::timeout(pause, stopping.wait_for(|stop| *stop)).await;
    }
}

/// One pass over the events to draw; `Some` when Claude's usage limit cut it short.
async fn draw_due(
    db: &PgPool,
    tried: &mut HashMap<i64, Instant>,
    checked: &mut Checked,
    stopping: &watch::Receiver<bool>,
) -> Result<Option<Limited>> {
    let retry = Duration::from_secs(INGESTION.title_svg_retry_hours * 3600);
    let due: Vec<(Waiting, Option<String>)> = featured_to_draw(db, checked)
        .await?
        .into_iter()
        .filter(|(event, _)| tried.get(&event.id).is_none_or(|at| at.elapsed() >= retry))
        .collect();
    let mut results = stream::iter(due)
        .map(|(event, drawing)| async move {
            let drawn = draw(&event).await;
            (event, drawing, drawn)
        })
        .buffer_unordered(INGESTION.title_svg_lanes.max(1));
    let mut unrefreshed: Vec<i64> = Vec::new();
    let mut limited = None;
    while let Some((event, drawing, drawn)) = results.next().await {
        match drawn {
            Ok(Drawn::Svg(svg)) => {
                // Only over the drawing this pass read, so a newer one is never replaced.
                sqlx::query(
                    "UPDATE public.events SET title_svg = $1 \
                     WHERE id = $2 AND md5(title_svg) IS NOT DISTINCT FROM $3",
                )
                .bind(&svg)
                .bind(event.id)
                .bind(&drawing)
                .execute(db)
                .await?;
                unrefreshed.push(event.id);
            }
            Ok(Drawn::Plain | Drawn::Rejected) => {}
            Err(error) => match error.downcast::<Limited>() {
                Ok(error) => {
                    limited = Some(error);
                    break;
                }
                Err(error) => tracing::warn!(event = event.id, "Title SVG not drawn: {error:#}"),
            },
        }
        tried.insert(event.id, Instant::now());
        if unrefreshed.len() >= REFRESH_EVERY {
            refresh_feeds(db, &std::mem::take(&mut unrefreshed)).await?;
        }
        if *stopping.borrow() {
            break;
        }
    }
    drop(results);
    refresh_feeds(db, &unrefreshed).await?;
    Ok(limited)
}

/// Whether each drawing seen spells its title and renders cleanly, by its
/// md5 and the title, so a pass reads and lays out only drawings it has not seen.
#[derive(Default)]
pub(super) struct Checked(HashMap<u64, bool>);

fn drawing_key(drawing: &str, title: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    (drawing, title).hash(&mut hasher);
    hasher.finish()
}

/// The featured events to come (an event Wat2Do posted in a carousel, as the
/// events feed marks it) with a poster but no drawing that spells their title
/// and renders cleanly, soonest first, each with its drawing's md5.
pub(super) async fn featured_to_draw(
    db: &PgPool,
    checked: &mut Checked,
) -> Result<Vec<(Waiting, Option<String>)>> {
    let events: Vec<(i64, String, String, Option<String>)> = sqlx::query_as(concat!(
        "SELECT e.id::bigint, e.title, e.source_image_url, md5(e.title_svg) FROM public.events e ",
        "JOIN LATERAL (SELECT min(d.dtstart_utc) AS starts FROM public.event_dates d ",
        "WHERE d.event_id = e.id AND coalesce(d.dtend_utc, d.dtstart_utc) >= now()) next ON true ",
        "WHERE next.starts IS NOT NULL AND NOT e.cancelled AND e.source_image_url LIKE 'https://%' ",
        "AND EXISTS (SELECT 1 ",
        featuring_slides!(),
        " AND i.event_id = e.id) ",
        "ORDER BY next.starts, e.id"
    ))
    .fetch_all(db)
    .await?;
    // Read and lay out only the drawings not seen before, off the async threads.
    let unseen: Vec<i64> = events
        .iter()
        .filter(|(_, title, _, drawing)| {
            drawing
                .as_deref()
                .is_some_and(|drawing| !checked.0.contains_key(&drawing_key(drawing, title)))
        })
        .map(|(id, ..)| *id)
        .collect();
    if !unseen.is_empty() {
        let drawings: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT md5(title_svg), title, title_svg FROM public.events \
             WHERE id::bigint = ANY($1) AND title_svg IS NOT NULL",
        )
        .bind(&unseen)
        .fetch_all(db)
        .await?;
        let verdicts = tokio::task::spawn_blocking(move || {
            drawings
                .into_iter()
                .map(|(drawing, title, svg)| {
                    let kept = spells_title(&svg, &title) && rendering_problem(&svg).is_none();
                    (drawing_key(&drawing, &title), kept)
                })
                .collect::<Vec<_>>()
        })
        .await?;
        checked.0.extend(verdicts);
    }
    Ok(events
        .into_iter()
        .filter(|(_, title, _, drawing)| {
            !drawing.as_deref().is_some_and(|drawing| {
                checked
                    .0
                    .get(&drawing_key(drawing, title))
                    .copied()
                    .unwrap_or(false)
            })
        })
        .map(|(id, title, poster, drawing)| (Waiting { id, title, poster }, drawing))
        .collect())
}

/// The title is written straight to the event, so its schools' cached event
/// feeds are refreshed the way ingestion's own writes refresh them.
async fn refresh_feeds(pool: &PgPool, events: &[i64]) -> Result<()> {
    if events.is_empty() {
        return Ok(());
    }
    let schools: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT s.slug FROM public.events e JOIN public.schools s ON s.id = e.school_id \
         WHERE e.id::bigint = ANY($1)",
    )
    .bind(events)
    .fetch_all(pool)
    .await?;
    revalidate_schools(&schools, &["events"]).await;
    Ok(())
}

/// Up to `title_svg_attempts` drawings of the event's title, until one is kept.
async fn draw(event: &Waiting) -> Result<Drawn> {
    let mut drawn = Drawn::Plain;
    for _ in 0..INGESTION.title_svg_attempts.max(1) {
        drawn = draw_once(event).await?;
        if !matches!(drawn, Drawn::Rejected) {
            break;
        }
    }
    Ok(drawn)
}

async fn draw_once(event: &Waiting) -> Result<Drawn> {
    let Some((data, content_type)) = fetch_image(&event.poster, true).await else {
        bail!("poster could not be fetched");
    };
    let workdir = tempfile::Builder::new().prefix(WORKDIR_PREFIX).tempdir()?;
    let file = format!("poster{}", extension(&content_type));
    tokio::fs::write(workdir.path().join(&file), &data).await?;
    let schema = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title_svg"],
        "properties": {"title_svg": {"type": ["string", "null"]}},
    });
    let answer = claude::run_agent(
        &prompt(&file, &event.title),
        workdir.path(),
        Agent {
            name: "Title SVG agent",
            model: &INGESTION.model,
            tools: &["Read"],
            allowed_tools: &["Read(./**)"],
            schema: &schema,
            timeout: Duration::from_secs(INGESTION.model_timeout_seconds),
            // The API server's PATH leaves Claude Code out.
            env: claude::claude_environment()
                .into_iter()
                .chain([("PATH".to_owned(), claude_code_path())])
                .collect(),
        },
    )
    .await?;
    let svg = match answer.get("title_svg") {
        Some(Value::String(svg)) if !svg.trim().is_empty() => svg.trim(),
        _ => return Ok(Drawn::Plain),
    };
    if !is_title_svg(svg) || !spells_title(svg, &event.title) {
        return Ok(Drawn::Rejected);
    }
    if let Some(problem) = rendering_problem(svg) {
        tracing::info!(event = event.id, "Title SVG drawn again: {problem}");
        return Ok(Drawn::Rejected);
    }
    Ok(Drawn::Svg(svg.to_owned()))
}

fn prompt(file: &str, title: &str) -> String {
    format!(
        "./{file} is the poster of a campus event listed as \"{title}\". Read it, then answer with \
         `title_svg`: {rules}\n\nAnswer `title_svg` with the SVG text, or null.",
        rules = TITLE_SVG_RULES.trim_end(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_svg_matches_the_database_shape_rule() {
        let title = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80"><text x="200" y="60" fill="#ffd400">Fall Formal</text></svg>"##;
        assert!(is_title_svg(title));
        assert!(is_title_svg(&format!("{title}\n")));
        assert!(!is_title_svg("<svgx></svgx>"));
        assert!(!is_title_svg("<p>Fall Formal</p>"));
        assert!(!is_title_svg(r#"<svg><script>alert(1)</script></svg>"#));
        assert!(!is_title_svg(r#"<svg><image href="x.png"/></svg>"#));
        assert!(!is_title_svg(r#"<svg><text onclick="x()">Hi</text></svg>"#));
        assert!(!is_title_svg(
            r#"<svg><a href="javascript:x()">Hi</a></svg>"#
        ));
        assert!(!is_title_svg(&format!(
            "<svg>{}</svg>",
            "a".repeat(MAX_LENGTH)
        )));
    }

    fn svg(lines: &[&str]) -> String {
        let texts: String = lines
            .iter()
            .map(|line| format!("<text>{line}</text>"))
            .collect();
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">{texts}</svg>"#)
    }

    #[test]
    fn a_drawing_that_spells_the_whole_title_is_kept() {
        let kpmg = "Join us for Networking with KPMG";
        assert!(spells_title(
            &svg(&["JOIN US FOR", "NETWORKING WITH KPMG"]),
            kpmg
        ));
        // Letter-spaced lettering, stacked shadows, curly apostrophes and accents all still spell it.
        assert!(spells_title(
            &svg(&["RUSH CUP", "B A S K E T B A L L"]),
            "Rush Cup Basketball"
        ));
        assert!(spells_title(
            &svg(&["BROTHERS’ GAMING", "BROTHERS’ GAMING", "NIGHT"]),
            "Brothers' Gaming Night"
        ));
        assert!(spells_title(
            &svg(&["RANDO- REFUGE DE L’AÉGUL"]),
            "Rando-Refuge de l'Aégul"
        ));
        assert!(spells_title(
            &svg(&["Mac &amp; Cheese Night"]),
            "Mac & Cheese Night"
        ));
        assert!(spells_title(&svg(&["CAF&#xC9; &#67;HAT"]), "Café Chat"));
        // Joining words the poster drops or sets as a symbol do not count.
        assert!(spells_title(
            &svg(&["NouLa x Le Gym 3v3", "BASKETBALL TOURNAMENT"]),
            "NouLa x Le Gym 3v3 Basketball Tournament"
        ));
    }

    #[test]
    fn a_drawing_that_leaves_a_word_out_or_draws_other_lettering_is_drawn_again() {
        // A sponsor set as a logo, left out of the drawing.
        let kpmg = "Join us for Networking with KPMG";
        assert!(!spells_title(
            &svg(&["JOIN US FOR", "NETWORKING WITH"]),
            kpmg
        ));
        assert!(!spells_title(
            &svg(&["Innov 8"]),
            "Innov8 with KPMG Case Competition"
        ));
        // The poster's header, not the event's title.
        assert!(!spells_title(
            &svg(&["WEEK AHEAD"]),
            "Brock Men's Hockey vs Guelph"
        ));
        assert!(!spells_title(&svg(&["TGIF"]), "TGIF Free Waffles"));
    }

    #[test]
    fn the_prompt_carries_the_shared_rules_and_the_title() {
        let prompt = prompt("poster.jpg", "Fall Formal");
        assert!(prompt.contains("./poster.jpg"));
        assert!(prompt.contains("\"Fall Formal\""));
        assert!(prompt.contains("textLength"));
        assert!(!prompt.contains("{{"));
    }
}
