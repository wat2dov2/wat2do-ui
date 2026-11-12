//! Drawing `events.title_svg` for events the ingestion agent did not draw.
//!
//! The ingestion agent draws an event's title SVG when it reads the event's
//! post. This draws it the same way, from the event's stored poster and the same
//! rules (`backend/services/ingestion/title_svg_rules.md`), and writes only
//! `title_svg`, keeping a drawing only when it spells the event's title and
//! renders cleanly on a card (`title_svg_rendering`).
//!
//! The API server's worker ([`run`]) keeps every featured event to come drawn,
//! so an event an admin features or a carousel posts shows its poster's
//! lettering on its featured card soon after. The backfill ([`backfill`]) draws
//! soon events listed before the agent drew titles; it tries each event once,
//! remembering the ones Claude left plain in the state directory, so a second
//! run picks up only what the first did not reach.

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use chrono::Utc;
use futures_util::{StreamExt, stream};
use regex::{Captures, Regex};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::watch;
use unicode_normalization::UnicodeNormalization;

use super::agent::extension;
use super::state_directory;
use super::title_svg_rendering::rendering_problem;
use crate::api::events::store::featuring_slides;
use crate::claude::{self, Agent, Limited};
use crate::controlbox::INGESTION;
use crate::images::fetch_image;
use crate::ingestion::prompt::TITLE_SVG_RULES;
use crate::launch_agents::claude_code_path;
use crate::revalidation::revalidate_schools;

const STATE_FILE: &str = "title-svgs.json";
/// Drawings between refreshes of their schools' event feeds, so a long run shows as it goes.
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

#[derive(Debug, Default, Serialize)]
pub struct Backfill {
    /// Events that start within the window and have no title SVG yet.
    pub waiting: usize,
    pub drawn: usize,
    /// Claude left the title plain (or unreadable); the page sets it as text.
    pub plain: usize,
    /// Claude's drawing broke the database's shape rule, left words of the title
    /// out, or would render badly on a card.
    pub rejected: usize,
    /// The poster could not be fetched or the agent failed; tried again next run.
    pub failed: usize,
    /// Set when Claude's usage limit stopped the run early.
    pub limited: Option<String>,
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

/// Draw the missing title SVGs of events starting within `days`, soonest first,
/// at most `limit` of them, `lanes` at a time; with `ids`, only those events
/// (such as the ones the featured rows show). With `redraw`, those events are
/// drawn again by the current rules even if drawn or tried before, and a title
/// Claude now leaves plain loses its old drawing. With `dry_run` only counts them.
pub async fn backfill(
    pool: &PgPool,
    days: i32,
    ids: &[i64],
    redraw: bool,
    limit: usize,
    lanes: usize,
    dry_run: bool,
) -> Result<Backfill> {
    if redraw && ids.is_empty() {
        bail!("--redraw redraws only the events named with --ids");
    }
    let mut tried = load_tried();
    let waiting: Vec<Waiting> = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT e.id::bigint, e.title, e.source_image_url FROM public.events e \
         JOIN LATERAL (SELECT min(d.dtstart_utc) AS starts FROM public.event_dates d \
             WHERE d.event_id = e.id AND d.dtstart_utc >= now()) next ON true \
         WHERE ($3 OR e.title_svg IS NULL) AND NOT e.cancelled \
           AND e.source_image_url LIKE 'https://%' \
           AND next.starts < now() + make_interval(days => $1) \
           AND (cardinality($2::bigint[]) = 0 OR e.id::bigint = ANY($2)) \
         ORDER BY next.starts, e.id",
    )
    .bind(days)
    .bind(ids)
    .bind(redraw)
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter(|(id, ..)| redraw || !tried.contains(id))
    .map(|(id, title, poster)| Waiting { id, title, poster })
    .collect();
    let mut report = Backfill {
        waiting: waiting.len(),
        ..Backfill::default()
    };
    if dry_run {
        return Ok(report);
    }

    let mut results = stream::iter(waiting.into_iter().take(limit))
        .map(|event| async move {
            let drawn = draw(&event).await;
            (event, drawn)
        })
        .buffer_unordered(lanes.max(1));
    // Drawn since the feeds were last refreshed.
    let mut unrefreshed: Vec<i64> = Vec::new();
    while let Some((event, drawn)) = results.next().await {
        let outcome = match drawn {
            Ok(Drawn::Svg(svg)) => Some((Some(svg), &mut report.drawn)),
            Ok(Drawn::Plain) => Some((None, &mut report.plain)),
            Ok(Drawn::Rejected) => Some((None, &mut report.rejected)),
            Err(error) => {
                if let Some(limited) = error.downcast_ref::<Limited>() {
                    // Every run fails the same way until the limit resets; stop here.
                    report.limited = Some(limited.message.clone());
                    break;
                }
                tracing::warn!(event = event.id, "Title SVG not drawn: {error:#}");
                report.failed += 1;
                None
            }
        };
        if let Some((svg, count)) = outcome {
            *count += 1;
            tried.insert(event.id);
            // A drawing is written over nothing; a redraw also replaces an old one,
            // or clears it when the title now stays plain.
            if svg.is_some() || redraw {
                sqlx::query(
                    "UPDATE public.events SET title_svg = $1 WHERE id = $2 AND ($3 OR title_svg IS NULL)",
                )
                .bind(&svg)
                .bind(event.id)
                .bind(redraw)
                .execute(pool)
                .await?;
                unrefreshed.push(event.id);
                if unrefreshed.len() >= REFRESH_EVERY {
                    refresh_feeds(pool, &std::mem::take(&mut unrefreshed)).await?;
                }
            }
        }
        save_tried(&tried)?;
    }
    save_tried(&tried)?;
    refresh_feeds(pool, &unrefreshed).await?;
    Ok(report)
}

/// Keep every featured event to come drawn ([`featured_to_draw`]): one with no
/// drawing, or one that does not spell its title or render cleanly, is drawn `title_svg_lanes` at a time, soonest
/// first, and an event none of whose drawings spelled it waits
/// `title_svg_retry_hours` before it is drawn again. Featured events are looked
/// for every `title_svg_poll_seconds`, and Claude's usage limit pauses the
/// drawings until it lifts.
pub async fn run(db: PgPool, mut stopping: watch::Receiver<bool>) {
    let mut tried: HashMap<i64, Instant> = HashMap::new();
    let mut checked = Checked::default();
    while !*stopping.borrow() {
        let pause = match draw_featured(&db, &mut tried, &mut checked, &stopping).await {
            Ok(None) => Duration::from_secs(INGESTION.title_svg_poll_seconds),
            Ok(Some(limited)) => {
                tracing::warn!(
                    "Featured title drawings wait for Claude: {}",
                    limited.message
                );
                limited
                    .resets_at
                    .and_then(|resets_at| (resets_at - Utc::now()).to_std().ok())
                    .unwrap_or(Duration::from_secs(INGESTION.agent_pause_seconds))
            }
            Err(error) => {
                tracing::error!("Featured title drawings failed: {error:#}");
                Duration::from_secs(INGESTION.title_svg_poll_seconds)
            }
        };
        let _ = tokio::time::timeout(pause, stopping.wait_for(|stop| *stop)).await;
    }
}

/// One pass over the featured events to come; `Some` when Claude's usage limit cut it short.
async fn draw_featured(
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
        .map(|(event, svg)| async move {
            let drawn = draw(&event).await;
            (event, svg, drawn)
        })
        .buffer_unordered(INGESTION.title_svg_lanes.max(1));
    let mut unrefreshed: Vec<i64> = Vec::new();
    let mut limited = None;
    while let Some((event, svg, drawn)) = results.next().await {
        match drawn {
            Ok(Drawn::Svg(drawing)) => {
                // Only over the drawing this pass read, so a newer one is never replaced.
                sqlx::query(
                    "UPDATE public.events SET title_svg = $1 \
                     WHERE id = $2 AND title_svg IS NOT DISTINCT FROM $3",
                )
                .bind(&drawing)
                .bind(event.id)
                .bind(&svg)
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

/// Whether each drawing seen renders cleanly, by its hash, so a pass lays out
/// only the drawings it has not seen.
#[derive(Default)]
pub(super) struct Checked(HashMap<u64, bool>);

impl Checked {
    fn renders_cleanly(&mut self, svg: &str) -> bool {
        let mut hasher = DefaultHasher::new();
        svg.hash(&mut hasher);
        *self
            .0
            .entry(hasher.finish())
            .or_insert_with(|| rendering_problem(svg).is_none())
    }
}

/// The featured events to come (an event Wat2Do posted in a carousel, as the
/// events feed marks it) with a poster but no drawing that spells their title
/// and renders cleanly, soonest first, each with the drawing it has.
pub(super) async fn featured_to_draw(
    db: &PgPool,
    checked: &mut Checked,
) -> Result<Vec<(Waiting, Option<String>)>> {
    Ok(sqlx::query_as::<_, (i64, String, String, Option<String>)>(concat!(
        "SELECT e.id::bigint, e.title, e.source_image_url, e.title_svg FROM public.events e ",
        "JOIN LATERAL (SELECT min(d.dtstart_utc) AS starts FROM public.event_dates d ",
        "WHERE d.event_id = e.id AND coalesce(d.dtend_utc, d.dtstart_utc) >= now()) next ON true ",
        "WHERE next.starts IS NOT NULL AND NOT e.cancelled AND e.source_image_url LIKE 'https://%' ",
        "AND EXISTS (SELECT 1 ",
        featuring_slides!(),
        " AND i.event_id = e.id) ORDER BY next.starts, e.id"
    ))
    .fetch_all(db)
    .await?
    .into_iter()
    .filter(|(_, title, _, svg)| {
        !svg.as_deref()
            .is_some_and(|svg| spells_title(svg, title) && checked.renders_cleanly(svg))
    })
    .map(|(id, title, poster, svg)| (Waiting { id, title, poster }, svg))
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

/// Up to `title_svg_attempts` drawings of the event's title, until one spells it.
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

fn state_path() -> PathBuf {
    state_directory().join(STATE_FILE)
}

fn load_tried() -> BTreeSet<i64> {
    std::fs::read(state_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_tried(tried: &BTreeSet<i64>) -> Result<()> {
    let path = state_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec(tried)?)?;
    Ok(())
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
