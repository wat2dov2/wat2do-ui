//! The calendar subscription feed (`calendar_service.py`): a user's Going
//! occurrences as a VCALENDAR, byte for byte what `icalendar` 7 wrote:
//! canonical property order, RFC 5545 TEXT escaping, folding at 75 octets
//! (never splitting a backslash escape), local times with `TZID` and UTC as `Z`.

use base64::Engine;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use sqlx::PgPool;
use uuid::Uuid;

use super::going::GoingSelection;
use crate::api::errors::ApiError;
use crate::db::read_with_retry;

/// `_PRODID`.
const PRODID: &str = "-//wat2do//calendar feed//EN";
/// `_TOKEN_BYTES`: 32 random bytes, about 43 URL-safe characters.
const TOKEN_BYTES: usize = 32;

/// The event fields the feed renders.
#[derive(Debug, Clone, PartialEq)]
pub struct FeedEvent {
    pub id: i64,
    pub title: String,
    pub location: Option<String>,
    pub club: Option<String>,
    pub description: Option<String>,
    /// The school's IANA zone (`resolve_school_timezone`), or UTC.
    pub timezone: String,
    pub added_at: DateTime<Utc>,
    pub occurrences: Vec<FeedOccurrence>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FeedOccurrence {
    pub id: Uuid,
    pub event_id: i64,
    pub dtstart_utc: DateTime<Utc>,
    pub dtend_utc: Option<DateTime<Utc>>,
}

/// `secrets.token_urlsafe(32)`.
pub fn new_token() -> String {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; TOKEN_BYTES];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system random source works");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// `_escape_char`: TEXT escaping, with every line ending as `\n`.
fn escape(text: &str) -> String {
    text.replace("\\N", "\n")
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace(['\n', '\r'], "\\n")
}

/// `_foldline`: lines of at most 75 octets, continued with CRLF and a space,
/// never ending a line on a lone `\` or `^`.
fn fold(line: &str) -> String {
    const LIMIT: usize = 75;
    let mut lines: Vec<String> = Vec::new();
    let mut current: Vec<char> = Vec::new();
    let mut bytes = 0;
    for character in line.chars() {
        let width = character.len_utf8();
        if !current.is_empty() && bytes + width >= LIMIT {
            if current.len() > 1 && matches!(current.last(), Some('\\' | '^')) {
                let carried = current.pop().expect("non-empty");
                lines.push(current.iter().collect());
                current = vec![carried];
                bytes = carried.len_utf8();
            } else {
                lines.push(current.iter().collect());
                current.clear();
                bytes = 0;
            }
        }
        current.push(character);
        bytes += width;
    }
    if !current.is_empty() {
        lines.push(current.iter().collect());
    }
    lines.join("\r\n ")
}

fn utc_stamp(value: &DateTime<Utc>) -> String {
    value.format("%Y%m%dT%H%M%SZ").to_string()
}

/// A DATE-TIME property: `Z` in UTC, else local time with `TZID`.
fn datetime_line(name: &str, value: &DateTime<Utc>, zone: Option<Tz>) -> String {
    match zone {
        Some(zone) if zone != Tz::UTC => format!(
            "{name};TZID={}:{}",
            zone.name(),
            value.with_timezone(&zone).format("%Y%m%dT%H%M%S")
        ),
        _ => format!("{name}:{}", utc_stamp(value)),
    }
}

/// `_event_to_vevents`: one VEVENT per occurrence, in canonical property order.
fn vevents(event: &FeedEvent, frontend: &str, dtstamp: &DateTime<Utc>, out: &mut Vec<String>) {
    if event.occurrences.is_empty() {
        tracing::debug!("Skipping event {} in ICS feed: no occurrences", event.id);
        return;
    }
    let zone: Option<Tz> = match event.timezone.parse::<Tz>() {
        Ok(zone) => Some(zone),
        Err(_) => {
            tracing::warn!(
                "ZoneInfo database missing {:?} - using UTC for event {}",
                event.timezone,
                event.id
            );
            None
        }
    };
    let url = format!("{frontend}/events/{}", event.id);
    let mut parts: Vec<&str> = Vec::new();
    if let Some(club) = event.club.as_deref().filter(|club| !club.is_empty()) {
        parts.push(club);
    }
    if let Some(description) = event.description.as_deref().filter(|text| !text.is_empty()) {
        parts.push(description);
    }
    parts.push(&url);
    let description = parts.join("\n\n");
    for occurrence in &event.occurrences {
        out.push("BEGIN:VEVENT".to_owned());
        out.push(format!("SUMMARY:{}", escape(&event.title)));
        out.push(datetime_line("DTSTART", &occurrence.dtstart_utc, zone));
        if let Some(end) = &occurrence.dtend_utc {
            out.push(datetime_line("DTEND", end, zone));
        }
        out.push(format!("DTSTAMP:{}", utc_stamp(dtstamp)));
        out.push(format!(
            "UID:{}",
            escape(&format!("event-{}-{}@wat2do.app", event.id, occurrence.id))
        ));
        out.push("SEQUENCE:0".to_owned());
        out.push(format!("DESCRIPTION:{}", escape(&description)));
        out.push(format!("LAST-MODIFIED:{}", utc_stamp(&event.added_at)));
        // `str(None)` when an event has no location.
        out.push(format!(
            "LOCATION:{}",
            escape(event.location.as_deref().unwrap_or("None"))
        ));
        out.push(format!("URL:{url}"));
        out.push("END:VEVENT".to_owned());
    }
}

/// `build_ics_for_user`'s rendering: the calendar for these events.
pub fn render(events: &[FeedEvent], frontend: &str, dtstamp: &DateTime<Utc>) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_owned(),
        "VERSION:2.0".to_owned(),
        format!("PRODID:{}", escape(PRODID)),
        "CALSCALE:GREGORIAN".to_owned(),
        "METHOD:PUBLISH".to_owned(),
        "X-WR-CALNAME:wat2do".to_owned(),
    ];
    for event in events {
        vevents(event, frontend, dtstamp, &mut lines);
    }
    lines.push("END:VCALENDAR".to_owned());
    let mut ics = String::new();
    for line in lines {
        ics.push_str(&fold(&line));
        ics.push_str("\r\n");
    }
    ics
}

/// `_fetch_selected_events`: each selected event with only the occurrences
/// chosen Going, in selection order (occurrences read 500 ids at a time,
/// each batch by start).
pub async fn selected_events(
    db: &PgPool,
    selections: &[GoingSelection],
) -> Result<Vec<FeedEvent>, ApiError> {
    let event_ids: Vec<i64> = selections
        .iter()
        .map(|selection| selection.event_id)
        .collect();
    if event_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut rows = Vec::new();
    for batch in event_ids.chunks(1000) {
        rows.extend(
            read_with_retry(|| {
                sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>, Option<String>, DateTime<Utc>)>(
                    "SELECT e.id::int8, e.title, e.location, e.club, e.description, s.slug, e.added_at \
                     FROM public.events e JOIN public.schools s ON s.id = e.school_id WHERE e.id = ANY($1)",
                )
                .bind(batch)
                .fetch_all(db)
            })
            .await?,
        );
    }
    let rows: std::collections::HashMap<i64, _> =
        rows.into_iter().map(|row| (row.0, row)).collect();
    let mut seen = std::collections::HashSet::new();
    let occurrence_ids: Vec<Uuid> = selections
        .iter()
        .flat_map(|selection| &selection.occurrence_ids)
        .filter(|id| seen.insert(**id))
        .copied()
        .collect();
    // Each event's occurrences in the order the batches returned them.
    let mut occurrences: std::collections::HashMap<i64, Vec<FeedOccurrence>> =
        std::collections::HashMap::new();
    for batch in occurrence_ids.chunks(500) {
        let found = read_with_retry(|| {
            sqlx::query_as::<_, (Uuid, i64, DateTime<Utc>, Option<DateTime<Utc>>)>(
                "SELECT id, event_id::int8, dtstart_utc, dtend_utc FROM public.event_dates \
                 WHERE id = ANY($1) ORDER BY dtstart_utc LIMIT 1000",
            )
            .bind(batch)
            .fetch_all(db)
        })
        .await?;
        for (id, event_id, dtstart_utc, dtend_utc) in found {
            occurrences
                .entry(event_id)
                .or_default()
                .push(FeedOccurrence {
                    id,
                    event_id,
                    dtstart_utc,
                    dtend_utc,
                });
        }
    }
    let mut events = Vec::new();
    for event_id in event_ids {
        let Some((id, title, location, club, description, school, added_at)) =
            rows.get(&event_id).cloned()
        else {
            continue;
        };
        let timezone = super::store::school_timezone(db, school.as_deref()).await?;
        events.push(FeedEvent {
            id,
            title,
            location,
            club,
            description,
            timezone,
            added_at,
            occurrences: occurrences.get(&event_id).cloned().unwrap_or_default(),
        });
    }
    Ok(events)
}

/// `get_or_create_token`.
pub async fn token_for(db: &PgPool, user_id: Uuid) -> Result<String, ApiError> {
    let existing: Option<Option<String>> = read_with_retry(|| {
        sqlx::query_scalar("SELECT calendar_feed_token FROM public.users WHERE id = $1 LIMIT 1")
            .bind(user_id)
            .fetch_optional(db)
    })
    .await?;
    match existing.flatten().filter(|token| !token.is_empty()) {
        Some(token) => Ok(token),
        None => rotate_token(db, user_id).await,
    }
}

/// `regenerate_token`: a new token; old subscriptions stop working.
pub async fn rotate_token(db: &PgPool, user_id: Uuid) -> Result<String, ApiError> {
    let token = new_token();
    sqlx::query("UPDATE public.users SET calendar_feed_token = $1 WHERE id = $2")
        .bind(&token)
        .bind(user_id)
        .execute(db)
        .await?;
    Ok(token)
}

/// `get_user_id_by_token`.
pub async fn user_for_token(db: &PgPool, token: &str) -> Result<Option<Uuid>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar("SELECT id FROM public.users WHERE calendar_feed_token = $1 LIMIT 1")
            .bind(token)
            .fetch_optional(db)
    })
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn parse_time(value: &Value) -> Option<DateTime<Utc>> {
        value.as_str().map(|text| {
            DateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%.f%:z")
                .or_else(|_| DateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%:z"))
                .unwrap()
                .with_timezone(&Utc)
        })
    }

    /// Calendars rendered by the real `calendar_service` (and `icalendar`
    /// 7.3) for fixed events and a fixed DTSTAMP.
    #[test]
    fn calendars_match_icalendar_byte_for_byte() {
        let corpus: Vec<Value> = serde_json::from_str(include_str!("testdata/ics.json")).unwrap();
        let zones = |school: Option<&str>| match school {
            Some("uwaterloo") => "America/Toronto",
            Some("ubc") => "America/Vancouver",
            Some("mun") => "America/St_Johns",
            _ => "UTC",
        };
        let dtstamp = "2026-11-02T01:02:03.456789Z"
            .parse::<DateTime<Utc>>()
            .unwrap();
        for case in corpus {
            let events: Vec<FeedEvent> = case["events"]
                .as_array()
                .unwrap()
                .iter()
                .map(|event| FeedEvent {
                    id: event["id"].as_i64().unwrap(),
                    title: event["title"].as_str().unwrap().to_owned(),
                    location: event["location"].as_str().map(str::to_owned),
                    club: event["club"].as_str().map(str::to_owned),
                    description: event["description"].as_str().map(str::to_owned),
                    timezone: zones(event["school"].as_str()).to_owned(),
                    added_at: parse_time(&event["added_at"]).unwrap(),
                    occurrences: event["occurrences"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|occurrence| FeedOccurrence {
                            id: occurrence["id"].as_str().unwrap().parse().unwrap(),
                            event_id: event["id"].as_i64().unwrap(),
                            dtstart_utc: parse_time(&occurrence["dtstart_utc"]).unwrap(),
                            dtend_utc: parse_time(&occurrence["dtend_utc"]),
                        })
                        .collect(),
                })
                .collect();
            assert_eq!(
                render(&events, "https://wat2do.io", &dtstamp),
                case["ics"].as_str().unwrap(),
                "{}",
                case["events"]
            );
        }
    }

    /// Read-only production check: `ICS_PARITY_FILE` holds Python's feed per
    /// user id (`calendar_service.build_ics_for_user`, DTSTAMP masked).
    #[tokio::test]
    #[ignore = "reads production through DATABASE_URL"]
    async fn production_feeds_match_python() {
        crate::install_tls();
        let expected: std::collections::BTreeMap<String, String> = serde_json::from_str(
            &std::fs::read_to_string(std::env::var("ICS_PARITY_FILE").unwrap()).unwrap(),
        )
        .unwrap();
        let db = crate::db::connect_lazy(
            crate::db::connect_options().unwrap(),
            2,
            std::time::Duration::from_secs(60),
            std::time::Duration::from_secs(30),
            true,
        );
        let mask = regex::Regex::new(r"DTSTAMP:\d{8}T\d{6}Z").unwrap();
        for (user_id, python) in &expected {
            let selections = super::super::going::selections(&db, user_id.parse().unwrap())
                .await
                .unwrap();
            let events = selected_events(&db, &selections).await.unwrap();
            let ours = render(&events, "https://wat2do.io", &Utc::now());
            assert_eq!(
                &mask.replace_all(&ours, "DTSTAMP:X"),
                python,
                "user {user_id}"
            );
        }
        assert!(expected.len() > 10);
    }

    #[test]
    fn tokens_are_43_url_safe_characters() {
        let token = new_token();
        assert_eq!(token.len(), 43);
        assert!(
            token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        );
        assert_ne!(token, new_token());
    }
}
