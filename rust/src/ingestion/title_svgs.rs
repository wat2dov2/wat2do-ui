//! Backfilling `events.title_svg` for listed events that start soon.
//!
//! The ingestion agent draws an event's title SVG when it reads the event's
//! post, so events listed before it learned to have none. This draws them the
//! same way, from the event's stored poster and the same rules
//! (`backend/services/ingestion/title_svg_rules.md`), and writes only
//! `title_svg`. Each event is tried once: an event whose title Claude leaves
//! plain is remembered in the state directory, so a second run picks up only
//! what the first did not reach.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::{Result, bail};
use futures_util::{StreamExt, stream};
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::agent::extension;
use super::state_directory;
use crate::claude::{self, Agent, Limited};
use crate::controlbox::INGESTION;
use crate::images::fetch_image;
use crate::ingestion::prompt::TITLE_SVG_RULES;

const STATE_FILE: &str = "title-svgs.json";
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

#[derive(Debug, Default, Serialize)]
pub struct Backfill {
    /// Events that start within the window and have no title SVG yet.
    pub waiting: usize,
    pub drawn: usize,
    /// Claude left the title plain (or unreadable); the page sets it as text.
    pub plain: usize,
    /// Claude's drawing broke the database's shape rule.
    pub rejected: usize,
    /// The poster could not be fetched or the agent failed; tried again next run.
    pub failed: usize,
    /// Set when Claude's usage limit stopped the run early.
    pub limited: Option<String>,
}

struct Waiting {
    id: i64,
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
/// (such as the ones the featured rows show). With `dry_run` only counts them.
pub async fn backfill(
    pool: &PgPool,
    days: i32,
    ids: &[i64],
    limit: usize,
    lanes: usize,
    dry_run: bool,
) -> Result<Backfill> {
    let mut tried = load_tried();
    let waiting: Vec<Waiting> = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT e.id::bigint, e.title, e.source_image_url FROM public.events e \
         JOIN LATERAL (SELECT min(d.dtstart_utc) AS starts FROM public.event_dates d \
             WHERE d.event_id = e.id AND d.dtstart_utc >= now()) next ON true \
         WHERE e.title_svg IS NULL AND NOT e.cancelled \
           AND e.source_image_url LIKE 'https://%' \
           AND next.starts < now() + make_interval(days => $1) \
           AND (cardinality($2::bigint[]) = 0 OR e.id::bigint = ANY($2)) \
         ORDER BY next.starts, e.id",
    )
    .bind(days)
    .bind(ids)
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter(|(id, ..)| !tried.contains(id))
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
    while let Some((event, drawn)) = results.next().await {
        match drawn {
            Ok(Drawn::Svg(svg)) => {
                sqlx::query(
                    "UPDATE public.events SET title_svg = $1 WHERE id = $2 AND title_svg IS NULL",
                )
                .bind(&svg)
                .bind(event.id)
                .execute(pool)
                .await?;
                report.drawn += 1;
                tried.insert(event.id);
            }
            Ok(Drawn::Plain) => {
                report.plain += 1;
                tried.insert(event.id);
            }
            Ok(Drawn::Rejected) => {
                report.rejected += 1;
                tried.insert(event.id);
            }
            Err(error) => {
                if let Some(limited) = error.downcast_ref::<Limited>() {
                    // Every run fails the same way until the limit resets; stop here.
                    report.limited = Some(limited.message.clone());
                    break;
                }
                tracing::warn!(event = event.id, "Title SVG not drawn: {error:#}");
                report.failed += 1;
            }
        }
        save_tried(&tried)?;
    }
    save_tried(&tried)?;
    Ok(report)
}

async fn draw(event: &Waiting) -> Result<Drawn> {
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
            env: claude::claude_environment(),
        },
    )
    .await?;
    Ok(match answer.get("title_svg") {
        Some(Value::String(svg)) if is_title_svg(svg.trim()) => Drawn::Svg(svg.trim().to_owned()),
        Some(Value::String(svg)) if !svg.trim().is_empty() => Drawn::Rejected,
        _ => Drawn::Plain,
    })
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

    #[test]
    fn the_prompt_carries_the_shared_rules_and_the_title() {
        let prompt = prompt("poster.jpg", "Fall Formal");
        assert!(prompt.contains("./poster.jpg"));
        assert!(prompt.contains("\"Fall Formal\""));
        assert!(prompt.contains("textLength"));
        assert!(!prompt.contains("{{"));
    }
}
