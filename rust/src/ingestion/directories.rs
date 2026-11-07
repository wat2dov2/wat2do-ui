//! Haiku directory agents reading the official school event directories
//! (`services/ingestion/directory_agent.py`).
//!
//! Each source in `public.directory_sources` gets one agent. It reads the
//! downloaded listing, opens event pages itself, skips what was already handled
//! or is already listed, and reports finished event and position details. Those
//! become `ready` rows in the ingestion queue for the processor to reconcile;
//! pages that are not events are remembered as `not_event` so no later run
//! looks at them again.

use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::path::Path;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, NaiveDateTime, Offset, TimeDelta, TimeZone, Utc};
use chrono_tz::Tz;
use fs2::FileExt;
use futures_util::{StreamExt, stream};
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use super::page_image::{download, fetch_event_poster};
use super::state_directory;
use crate::claude::{self, Agent, Limited, claude_environment, remove_leftovers};
use crate::controlbox::INGESTION;
use crate::pyjson::dumps;
use crate::schools;
use crate::urls::urlsplit;

pub const WORKDIR_PREFIX: &str = "wat2do-directory-";
const PROMPT: &str = include_str!("../../../backend/services/ingestion/directory_prompt.md");
const DETAIL_FIELDS: [&str; 6] = ["title", "starts", "ends", "location", "host", "description"];

static REPORT_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["url", "verdict"],
                    "properties": {
                        "url": {"type": "string"},
                        "verdict": {
                            "enum": ["event", "position", "changed", "already_listed", "not_event"]
                        },
                        "title": {"type": "string"},
                        "starts": {"type": "array", "items": {"type": "string"}},
                        "ends": {"type": "array", "items": {"type": "string"}},
                        "location": {"type": "string"},
                        "host": {"type": "string"},
                        "description": {"type": "string"},
                    },
                },
            }
        },
    })
});

/// Run totals, printed with sorted keys like the Python script's JSON.
pub type Counts = BTreeMap<String, u64>;

/// One row of `public.directory_sources`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Source {
    pub id: i64,
    pub school: String,
    pub name: String,
    pub url: String,
}

pub async fn list_sources(pool: &PgPool) -> Result<Vec<Source>> {
    Ok(sqlx::query_as(
        "SELECT source.id, coalesce(school.slug, '') AS school, source.name, source.url \
         FROM public.directory_sources AS source \
         LEFT JOIN public.schools AS school ON school.id = source.school_id \
         ORDER BY source.id",
    )
    .fetch_all(pool)
    .await?)
}

/// Run one agent per directory source, a few at a time, until Claude's usage
/// limit turns one away; the sources left wait for the next run.
pub async fn scrape_directories(pool: &PgPool) -> Result<Counts> {
    let directory = state_directory();
    std::fs::create_dir_all(&directory)?;
    let lock = File::options()
        .create(true)
        .append(true)
        .open(directory.join("directories.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(Counts::from([("busy".to_owned(), 1)]));
    }
    remove_leftovers(WORKDIR_PREFIX);
    let sources = list_sources(pool).await?;
    let limited = AtomicBool::new(false);
    let mut results = stream::iter(sources)
        .map(|source| scrape_safely(pool, source, &limited))
        .buffer_unordered(INGESTION.directory_agents);
    let mut totals = Counts::new();
    while let Some(counts) = results.next().await {
        add(&mut totals, counts);
    }
    Ok(totals)
}

fn add(totals: &mut Counts, counts: Counts) {
    for (key, count) in counts {
        *totals.entry(key).or_default() += count;
    }
}

async fn scrape_safely(pool: &PgPool, source: Source, limited: &AtomicBool) -> Counts {
    if limited.load(Ordering::Relaxed) {
        return Counts::from([("skipped_sources".to_owned(), 1)]);
    }
    match scrape_source(pool, &source).await {
        Ok(counts) => counts,
        Err(error) => {
            // One unreachable directory never stops the others; the usage limit stops them all.
            limited.fetch_or(error.is::<Limited>(), Ordering::Relaxed);
            tracing::warn!("Directory source {} failed ({error})", source.id);
            Counts::from([("failed_sources".to_owned(), 1)])
        }
    }
}

async fn scrape_source(pool: &PgPool, source: &Source) -> Result<Counts> {
    let prepared = prepare(pool, source, Utc::now()).await?;
    let workdir = tempfile::Builder::new().prefix(WORKDIR_PREFIX).tempdir()?;
    prepared.write_files(workdir.path())?;
    let reported = run(&prepared.prompt, workdir.path()).await?;
    drop(workdir);
    save(pool, source, &prepared, &reported).await
}

/// Everything an agent is given for one source, gathered before it starts.
pub struct Prepared {
    pub school_id: i32,
    pub listing: Vec<u8>,
    pub listing_file: String,
    /// URLs already handled from this source, with their status and details.
    pub handled: Vec<Value>,
    /// Events and positions already on wat2do for the school in the window.
    pub listed: Value,
    pub prompt: String,
}

impl Prepared {
    /// The agent's folder: the listing, `handled.json` and `listed.json`.
    pub fn write_files(&self, folder: &Path) -> Result<()> {
        std::fs::write(folder.join(&self.listing_file), &self.listing)?;
        std::fs::write(
            folder.join("handled.json"),
            dumps(&Value::Array(self.handled.clone()), Some(1)),
        )?;
        std::fs::write(folder.join("listed.json"), dumps(&self.listed, Some(1)))?;
        Ok(())
    }

    fn statuses(&self) -> HashMap<&str, &str> {
        self.handled
            .iter()
            .map(|row| {
                (
                    row["url"].as_str().unwrap_or_default(),
                    row["status"].as_str().unwrap_or_default(),
                )
            })
            .collect()
    }
}

/// Read the school, what this source already handled, the listing and what is
/// listed, and render the agent's prompt.
pub async fn prepare(pool: &PgPool, source: &Source, now: DateTime<Utc>) -> Result<Prepared> {
    let Some(school) = schools::by_slug(pool, &source.school).await? else {
        bail!("School is not registered");
    };
    let timezone: Tz = school
        .timezone
        .parse()
        .map_err(|_| anyhow!("Unknown timezone"))?;
    let local_now = now.with_timezone(&timezone);
    let horizon = add_wall_days(
        &timezone,
        local_now.naive_local(),
        INGESTION.directory_horizon_days,
    );
    let handled = handled(pool, source.id).await?;
    let listing = download(
        &source.url,
        Duration::from_secs_f64(INGESTION.fetch_timeout_seconds),
        INGESTION.directory_listing_max_bytes,
    )
    .await
    .context("listing download failed")?;
    let listing_file = format!("listing{}", extension(&listing));
    let listed = listed(pool, school.id, horizon.with_timezone(&Utc), &timezone).await?;
    let prompt = render_prompt(&[
        ("name", source.name.clone()),
        ("school", source.school.clone()),
        (
            "lists_university_events",
            schools::lists_university_events(&source.school).to_owned(),
        ),
        ("listing_url", source.url.clone()),
        ("listing_file", listing_file.clone()),
        ("today", local_now.format("%A %Y-%m-%d").to_string()),
        ("timezone", school.timezone.clone()),
        ("horizon_end", horizon.format("%A %Y-%m-%d").to_string()),
        ("max_items", INGESTION.directory_items_per_run.to_string()),
    ]);
    Ok(Prepared {
        school_id: school.id,
        listing,
        listing_file,
        handled,
        listed,
        prompt,
    })
}

/// Substituted in this order, like the Python loop over its values dict.
fn render_prompt(values: &[(&str, String)]) -> String {
    let mut prompt = PROMPT.to_owned();
    for (key, value) in values {
        prompt = prompt.replace(&format!("{{{{{key}}}}}"), value);
    }
    prompt
}

/// `now + timedelta(days=n)` on an aware Python datetime: the wall clock moves
/// by whole days, so the window ends at the same local time across a DST change.
fn add_wall_days(timezone: &Tz, local: NaiveDateTime, days: u32) -> DateTime<Tz> {
    let wall = local + TimeDelta::days(i64::from(days));
    match timezone.from_local_datetime(&wall) {
        chrono::LocalResult::Single(time) => time,
        // fold=0: the earlier of the two readings of a repeated hour.
        chrono::LocalResult::Ambiguous(earlier, _) => earlier,
        // fold=0 in a skipped hour keeps the offset from before the change.
        chrono::LocalResult::None => {
            let before = timezone
                .offset_from_utc_datetime(&(wall - TimeDelta::days(1)))
                .fix();
            timezone.from_utc_datetime(&(wall - before))
        }
    }
}

/// The listing's file extension, from its first bytes.
pub fn extension(listing: &[u8]) -> &'static str {
    let head = &listing[..listing.len().min(512)];
    // bytes.lstrip(): ASCII whitespace including vertical tab.
    let start = head
        .iter()
        .position(|byte| !matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c))
        .unwrap_or(head.len());
    let head = &head[start..];
    if head.starts_with(b"BEGIN:VCALENDAR") {
        ".ics"
    } else if matches!(head.first(), Some(b'{' | b'[')) {
        ".json"
    } else {
        ".html"
    }
}

async fn handled(pool: &PgPool, source_id: i64) -> Result<Vec<Value>> {
    let rows: Vec<(String, String, Option<Value>)> = sqlx::query_as(
        "SELECT source_url::text, status, post FROM public.ingestion_items \
         WHERE directory_source_id = $1 ORDER BY created_at, source_url",
    )
    .bind(source_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(url, status, post)| {
            let mut row = Map::new();
            row.insert("url".into(), Value::String(url));
            row.insert("status".into(), Value::String(status));
            if let Some(Value::Object(details)) = post.as_ref().and_then(|post| post.get("details"))
            {
                for (key, value) in details {
                    row.insert(key.clone(), value.clone());
                }
            }
            Value::Object(row)
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct ListedDate {
    dtstart_utc: DateTime<Utc>,
    id: i32,
    title: Option<String>,
    location: Option<String>,
    club: Option<String>,
    source_url: Option<String>,
    school_id: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct ListedPosition {
    id: i64,
    title: Option<String>,
    source_url: Option<String>,
    club_id: Option<i32>,
}

async fn listed(
    pool: &PgPool,
    school_id: i32,
    horizon: DateTime<Utc>,
    timezone: &Tz,
) -> Result<Value> {
    let dates: Vec<ListedDate> = sqlx::query_as(
        "SELECT date.dtstart_utc, event.id, event.title::text, event.location::text, \
                event.club::text, event.source_url::text, event.school_id \
         FROM public.event_dates AS date JOIN public.events AS event ON event.id = date.event_id \
         WHERE event.school_id = $1 AND date.dtstart_utc >= now() AND date.dtstart_utc <= $2 \
         ORDER BY date.dtstart_utc, event.id, date.id",
    )
    .bind(school_id)
    .bind(horizon)
    .fetch_all(pool)
    .await?;
    let positions: Vec<ListedPosition> = sqlx::query_as(
        "SELECT id, title::text, source_url::text, club_id FROM public.positions \
         WHERE school_id = $1 AND is_active ORDER BY id",
    )
    .bind(school_id)
    .fetch_all(pool)
    .await?;
    let events: Vec<Value> = dates
        .into_iter()
        .map(|date| {
            // In the order PostgREST gave Python's embedded event (jsonb's key order),
            // so the agent's file is unchanged.
            json!({
                "id": date.id,
                "club": date.club,
                "title": date.title,
                "location": date.location,
                "school_id": date.school_id,
                "source_url": date.source_url,
                "start": date.dtstart_utc.with_timezone(timezone).format("%Y-%m-%dT%H:%M").to_string(),
            })
        })
        .collect();
    let positions: Vec<Value> = positions
        .into_iter()
        .map(|position| {
            json!({
                "id": position.id,
                "title": position.title,
                "source_url": position.source_url,
                "club_id": position.club_id,
            })
        })
        .collect();
    Ok(json!({"events": events, "positions": positions}))
}

async fn run(prompt: &str, workdir: &Path) -> Result<Vec<Map<String, Value>>> {
    let answer = claude::run_agent(
        prompt,
        workdir,
        Agent {
            name: "Directory agent",
            model: &INGESTION.model,
            tools: &["Read", "Grep", "WebFetch"],
            allowed_tools: &["Read(./**)", "Grep(./**)", "WebFetch"],
            schema: &REPORT_SCHEMA,
            timeout: Duration::from_secs(INGESTION.directory_model_timeout_seconds),
            env: claude_environment(),
        },
    )
    .await?;
    report_items(&answer)
}

fn report_items(answer: &Map<String, Value>) -> Result<Vec<Map<String, Value>>> {
    let Some(Value::Array(items)) = answer.get("items") else {
        bail!("Directory agent gave no report");
    };
    Ok(items
        .iter()
        .filter_map(|item| item.as_object().cloned())
        .collect())
}

/// What `save` does with one reported item.
#[derive(Debug, PartialEq)]
enum Decision {
    Invented,
    Skip,
    Changed,
    Queue,
    AlreadyListed,
    NotEvent,
}

fn decide(
    item: &Map<String, Value>,
    statuses: &HashMap<&str, &str>,
    page: &str,
    host: &str,
) -> (String, Decision) {
    let url = item
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let verdict = item.get("verdict").and_then(Value::as_str);
    let decision = if !plausible(&url, page, host) {
        Decision::Invented
    } else if verdict == Some("changed") {
        if statuses.get(url.as_str()) == Some(&"done") {
            Decision::Changed
        } else {
            Decision::Skip
        }
    } else if statuses.contains_key(url.as_str()) {
        Decision::Skip
    } else {
        match verdict {
            Some("event" | "position") => Decision::Queue,
            Some("already_listed") => Decision::AlreadyListed,
            _ => Decision::NotEvent,
        }
    };
    (url, decision)
}

/// Queue what the agent found; remember everything it decided about.
async fn save(
    pool: &PgPool,
    source: &Source,
    prepared: &Prepared,
    reported: &[Map<String, Value>],
) -> Result<Counts> {
    let mut counts = Counts::new();
    let statuses = prepared.statuses();
    let page = htmlize::unescape(String::from_utf8_lossy(&prepared.listing)).into_owned();
    let host = urlsplit(&source.url, "")
        .ok()
        .and_then(|split| split.hostname())
        .unwrap_or_default();
    for item in reported.iter().take(INGESTION.directory_items_per_run) {
        let (url, decision) = decide(item, &statuses, &page, &host);
        let remember = |status: &'static str, post: Option<Value>| {
            insert(pool, &url, prepared.school_id, source.id, status, post)
        };
        let counted = match decision {
            Decision::Invented => "invented_urls",
            Decision::Skip => continue,
            Decision::Changed => {
                let poster = fetch_event_poster(&url).await;
                update_ready(pool, &url, &post(&url, item, poster)).await?;
                "changed"
            }
            Decision::Queue => {
                let poster = fetch_event_poster(&url).await;
                remember("ready", Some(post(&url, item, poster))).await?;
                "queued"
            }
            Decision::AlreadyListed => {
                remember("done", Some(post(&url, item, None))).await?;
                "already_listed"
            }
            Decision::NotEvent => {
                remember("not_event", None).await?;
                "not_events"
            }
        };
        *counts.entry(counted.to_owned()).or_default() += 1;
    }
    Ok(counts)
}

/// A reported URL must appear in the listing or live on the directory's own site.
fn plausible(url: &str, page: &str, listing_host: &str) -> bool {
    let Ok(parts) = urlsplit(url, "") else {
        return false;
    };
    let Some(hostname) = parts.hostname() else {
        return false;
    };
    if parts.scheme != "https" {
        return false;
    }
    if page.contains(url) || page.contains(url.trim_end_matches('/')) {
        return true;
    }
    let labels: Vec<&str> = listing_host.split('.').collect();
    let site = labels[labels.len().saturating_sub(2)..].join(".");
    hostname == site || hostname.ends_with(&format!(".{site}"))
}

/// Python's truthiness for a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64() != Some(0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

/// How Python's f-strings print a JSON value.
fn display(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The processor's view of a directory page: finished text plus its poster.
fn post(url: &str, item: &Map<String, Value>, poster: Option<String>) -> Value {
    let details: Map<String, Value> = DETAIL_FIELDS
        .iter()
        .filter_map(|field| {
            item.get(*field)
                .filter(|value| truthy(value))
                .map(|value| ((*field).to_owned(), value.clone()))
        })
        .collect();
    let list = |field: &str| -> Vec<Value> {
        details
            .get(field)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let (starts, ends) = (list("starts"), list("ends"));
    let when = starts
        .iter()
        .enumerate()
        .map(|(index, start)| match ends.get(index) {
            Some(end) => format!("{} to {}", display(start), display(end)),
            None => display(start),
        })
        .collect::<Vec<_>>()
        .join("; ");
    let field = |name: &str| details.get(name).map(display).unwrap_or_default();
    let kind = match item.get("verdict") {
        Some(Value::String(verdict)) if verdict == "changed" => "event".to_owned(),
        Some(verdict) => display(verdict),
        None => "None".to_owned(),
    };
    let text = [
        format!("Kind: {kind}"),
        format!("Title: {}", field("title")),
        format!("When: {when}"),
        format!("Where: {}", field("location")),
        format!("Host: {}", field("host")),
        format!("Description: {}", field("description")),
    ]
    .join("\n");
    json!({
        "url": url,
        "text": text,
        "images": poster.into_iter().collect::<Vec<_>>(),
        "details": details,
    })
}

async fn insert(
    pool: &PgPool,
    url: &str,
    school_id: i32,
    source_id: i64,
    status: &str,
    post: Option<Value>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO public.ingestion_items \
         (source_url, school_id, source, directory_source_id, status, post) \
         VALUES ($1, $2, 'directory', $3, $4, $5) ON CONFLICT (source_url) DO NOTHING",
    )
    .bind(url)
    .bind(school_id)
    .bind(source_id)
    .bind(status)
    .bind(post)
    .execute(pool)
    .await?;
    Ok(())
}

async fn update_ready(pool: &PgPool, url: &str, post: &Value) -> Result<()> {
    sqlx::query(
        "UPDATE public.ingestion_items SET status = 'ready', post = $2, attempts = 0, \
         claimed_until = NULL, updated_at = now() WHERE source_url = $1 AND status = 'done'",
    )
    .bind(url)
    .bind(post)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING_URL: &str = "https://clubs.example.edu/events";
    const LISTING: &str = r#"<html><a href="https://clubs.example.edu/events/jam">Jam</a>
<a href="https://clubs.example.edu/events/office-hours">Office hours</a>
<a href="https://clubs.example.edu/events/gala">Gala</a>
<a href="https://clubs.example.edu/events/old">Old</a></html>"#;

    fn item(value: Value) -> Map<String, Value> {
        value.as_object().cloned().expect("an object")
    }

    fn decisions(handled: &[(&str, &str)], reported: &[Value]) -> Vec<Decision> {
        let statuses: HashMap<&str, &str> = handled.iter().copied().collect();
        let host = urlsplit(LISTING_URL, "").unwrap().hostname().unwrap();
        reported
            .iter()
            .map(|reported| decide(&item(reported.clone()), &statuses, LISTING, &host).1)
            .collect()
    }

    #[test]
    fn agent_findings_become_queue_decisions() {
        let reported = [
            json!({"url": "https://clubs.example.edu/events/jam", "verdict": "event", "title": "Jam"}),
            json!({"url": "https://clubs.example.edu/events/office-hours", "verdict": "not_event"}),
            json!({"url": "https://clubs.example.edu/events/gala", "verdict": "already_listed"}),
            json!({"url": "https://clubs.example.edu/events/old", "verdict": "changed", "title": "Old"}),
            // Invented: neither in the listing nor on the directory's site.
            json!({"url": "https://elsewhere.example.com/x", "verdict": "event", "title": "X"}),
            // Already handled and unchanged: never queued again.
            json!({"url": "https://clubs.example.edu/events/old", "verdict": "event", "title": "Old"}),
        ];
        assert_eq!(
            decisions(
                &[("https://clubs.example.edu/events/old", "done")],
                &reported
            ),
            [
                Decision::Queue,
                Decision::NotEvent,
                Decision::AlreadyListed,
                Decision::Changed,
                Decision::Invented,
                Decision::Skip,
            ]
        );
    }

    #[test]
    fn a_change_is_only_queued_for_a_finished_row() {
        let reported = [
            json!({"url": "https://clubs.example.edu/events/jam", "verdict": "changed"}),
            json!({"url": "https://clubs.example.edu/events/gala", "verdict": "changed"}),
            // A change to a URL never handled is not queued either.
            json!({"url": "https://clubs.example.edu/events/new", "verdict": "changed"}),
        ];
        assert_eq!(
            decisions(
                &[
                    ("https://clubs.example.edu/events/jam", "ready"),
                    ("https://clubs.example.edu/events/gala", "not_event"),
                ],
                &reported
            ),
            [Decision::Skip, Decision::Skip, Decision::Skip]
        );
    }

    #[test]
    fn an_unknown_or_missing_verdict_is_remembered_as_not_an_event() {
        let reported = [
            json!({"url": " https://clubs.example.edu/events/jam ", "verdict": "maybe"}),
            json!({"url": "https://clubs.example.edu/events/gala"}),
        ];
        assert_eq!(
            decisions(&[], &reported),
            [Decision::NotEvent, Decision::NotEvent]
        );
    }

    #[test]
    fn plausible_urls_are_in_the_listing_or_on_its_site() {
        let host = "clubs.example.edu";
        // On the directory's own site (its last two labels), listed or not.
        assert!(plausible("https://example.edu/x", "", host));
        assert!(plausible("https://www.Example.edu/x", "", host));
        assert!(!plausible("https://notexample.edu/x", "", host));
        // Elsewhere, only when the listing shows it, with or without a trailing slash.
        assert!(plausible(
            "https://partner.org/e/1/",
            "see https://partner.org/e/1",
            host
        ));
        assert!(!plausible(
            "https://partner.org/e/2",
            "see https://partner.org/e/1",
            host
        ));
        // Only https URLs with a host.
        assert!(!plausible(
            "http://clubs.example.edu/x",
            "http://clubs.example.edu/x",
            host
        ));
        assert!(!plausible("https:///x", "https:///x", host));
        assert!(!plausible("", "", host));
        assert!(!plausible("https://[::1/x", "https://[::1/x", host));
    }

    #[test]
    fn a_post_lists_the_details_the_agent_gave() {
        let reported = item(json!({
            "url": "https://clubs.example.edu/events/jam",
            "verdict": "event",
            "title": "Jam",
            "starts": ["2026-10-21T19:00", "2026-10-28T19:00"],
            "ends": ["2026-10-21T21:00"],
            "location": "Houston Hall 201",
            "host": "Penn Jazz",
            "description": "",
        }));
        let built = post(
            "https://clubs.example.edu/events/jam",
            &reported,
            Some("https://clubs.example.edu/jam.png".into()),
        );
        assert_eq!(
            built["text"],
            "Kind: event\nTitle: Jam\nWhen: 2026-10-21T19:00 to 2026-10-21T21:00; 2026-10-28T19:00\n\
             Where: Houston Hall 201\nHost: Penn Jazz\nDescription: "
        );
        assert_eq!(
            built["images"],
            json!(["https://clubs.example.edu/jam.png"])
        );
        // Empty fields are left out of the details.
        assert_eq!(
            built["details"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            ["title", "starts", "ends", "location", "host"]
        );
        let changed = post(
            "https://clubs.example.edu/events/old",
            &item(json!({"url": "x", "verdict": "changed"})),
            None,
        );
        assert!(
            changed["text"]
                .as_str()
                .unwrap()
                .starts_with("Kind: event\nTitle: \nWhen: \n")
        );
        assert_eq!(changed["images"], json!([]));
        let listed = post("x", &item(json!({"verdict": "already_listed"})), None);
        assert!(
            listed["text"]
                .as_str()
                .unwrap()
                .starts_with("Kind: already_listed\n")
        );
    }

    #[test]
    fn listing_file_is_named_for_its_format() {
        for (listing, expected) in [
            (&b"BEGIN:VCALENDAR\nEND:VCALENDAR"[..], ".ics"),
            (b"  {\"events\": []}", ".json"),
            (b"\x0b\x0c\r\n[]", ".json"),
            (b"[]", ".json"),
            (b"<!doctype html><html></html>", ".html"),
            (b"", ".html"),
        ] {
            assert_eq!(extension(listing), expected);
        }
    }

    #[test]
    fn the_prompt_fills_every_placeholder() {
        let prompt = render_prompt(&[
            ("name", "Penn Clubs".into()),
            ("school", "upenn".into()),
            ("lists_university_events", "no".into()),
            ("listing_url", LISTING_URL.into()),
            ("listing_file", "listing.html".into()),
            ("today", "Monday 2026-11-02".into()),
            ("timezone", "America/New_York".into()),
            ("horizon_end", "Wednesday 2026-12-02".into()),
            ("max_items", "40".into()),
        ]);
        assert!(prompt.contains("Listing: https://clubs.example.edu/events"));
        assert!(prompt.contains("./listing.html"));
        assert!(!prompt.contains("{{"));
    }

    #[test]
    fn the_window_ends_at_the_same_wall_time_across_a_dst_change() {
        let toronto: Tz = "America/Toronto".parse().unwrap();
        // 2026-10-20 12:00 EDT + 30 days is 2026-11-19 12:00 EST.
        let start = NaiveDateTime::parse_from_str("2026-10-20 12:00", "%Y-%m-%d %H:%M").unwrap();
        let end = add_wall_days(&toronto, start, 30);
        assert_eq!(
            end.with_timezone(&Utc).to_rfc3339(),
            "2026-11-19T17:00:00+00:00"
        );
        // A repeated hour reads as its first (daylight) occurrence, like fold=0.
        let repeated = NaiveDateTime::parse_from_str("2026-10-02 01:30", "%Y-%m-%d %H:%M").unwrap();
        assert_eq!(
            add_wall_days(&toronto, repeated, 30)
                .with_timezone(&Utc)
                .to_rfc3339(),
            "2026-11-01T05:30:00+00:00"
        );
        // A skipped hour keeps the offset from before the change, like fold=0.
        let skipped = NaiveDateTime::parse_from_str("2026-02-06 02:30", "%Y-%m-%d %H:%M").unwrap();
        assert_eq!(
            add_wall_days(&toronto, skipped, 30)
                .with_timezone(&Utc)
                .to_rfc3339(),
            "2026-03-08T07:30:00+00:00"
        );
    }

    #[test]
    fn a_report_needs_an_items_list() {
        assert!(report_items(&item(json!({"items": "oops"}))).is_err());
        assert!(report_items(&Map::new()).is_err());
        assert_eq!(
            report_items(&item(
                json!({"items": [{"url": "a", "verdict": "event"}, "junk"]})
            ))
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn the_agent_gets_only_read_tools() {
        // The schema the agent must answer with, and nothing that runs commands.
        assert_eq!(REPORT_SCHEMA["required"], json!(["items"]));
        let verdicts =
            &REPORT_SCHEMA["properties"]["items"]["items"]["properties"]["verdict"]["enum"];
        assert_eq!(verdicts.as_array().unwrap().len(), 5);
        let environment = claude_environment();
        assert!(environment.keys().all(|name| !name.starts_with("PG")));
        assert!(!environment.contains_key("DATA_API_KEY"));
        assert!(!environment.contains_key("DATABASE_URL"));
    }

    #[test]
    fn totals_add_up_across_sources() {
        let mut totals = Counts::new();
        add(&mut totals, Counts::from([("queued".to_owned(), 3)]));
        add(
            &mut totals,
            Counts::from([("failed_sources".to_owned(), 1), ("queued".to_owned(), 2)]),
        );
        assert_eq!(
            serde_json::to_string(&totals).unwrap(),
            r#"{"failed_sources":1,"queued":5}"#
        );
    }
}
