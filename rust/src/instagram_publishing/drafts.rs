//! Each school's daily draft (`service.py`): the candidate packets Claude
//! chooses from, and saving its choices as a draft an admin reviews.
//!
//! A school's candidates are only the events added since its last carousel (or
//! asked for in our DMs): an event collected earlier never comes back to fill
//! a carousel. One draft per school per day: a later run never replaces one
//! that exists, whatever its status.

use std::collections::{HashMap, HashSet};

use anyhow::{Result, anyhow};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::selection::{DraftSelection, validate_picks};
use super::{Refused, error_message, isoformat, job_error, postgres_json_datetime};
use crate::api::events::store;
use crate::api::routes::instagram_publishing::batches::{
    self, KIND_EVENTS, STATUS_EMPTY, STATUS_FAILED, STATUS_GENERATING, STATUS_PUBLISHED,
    STATUS_READY_FOR_REVIEW,
};
use crate::api::routes::instagram_publishing::captions::{
    CaptionEvent, CaptionSchool, build_caption, default_caption_intro,
};
use crate::constants::EVENT_CATEGORIES;
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::text::python_strip;
use crate::time_zones::Tz;

/// A packet whose school has no draft today yet.
pub const NEEDS_REVIEW: &str = "needs_review";

/// The day a draft belongs to: `now` in the control box's generation zone.
pub fn local_date(now: DateTime<Utc>) -> NaiveDate {
    let zone: Tz = INSTAGRAM_PUBLISHING
        .generation_timezone
        .parse()
        .expect("controlbox generation_timezone is an IANA zone");
    now.with_timezone(&zone).date_naive()
}

/// One event a school's carousel could show, flattened onto the first
/// occurrence its slide would print (`_with_occurrence`).
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct Candidate {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub club: Option<String>,
    pub ig_handle: Option<String>,
    pub source_image_url: Option<String>,
    pub category: Option<String>,
    pub employers_on_campus: Option<bool>,
    /// As Postgres wrote it to JSON, so `5` stays an integer and `5.5` a float.
    pub price: Option<Value>,
    pub food: Option<Value>,
    pub registration: bool,
    pub carousel_requested_at: Option<DateTime<Utc>>,
    #[sqlx(skip)]
    pub dtstart_utc: DateTime<Utc>,
    #[sqlx(skip)]
    pub dtend_utc: Option<DateTime<Utc>>,
    /// The school's zone: slides print local times.
    #[sqlx(skip)]
    pub tz: String,
}

/// The columns a candidate reads (`_EVENT_COLUMNS`).
const EVENT_COLUMNS: &str = "e.id::int8 AS id, e.title, e.description, e.location, e.club, \
     e.ig_handle, e.source_image_url, e.category, e.employers_on_campus, \
     to_jsonb(e.price) AS price, e.food, e.registration, e.carousel_requested_at";

fn timestamp(value: &Option<DateTime<Utc>>) -> Value {
    value
        .as_ref()
        .map_or(Value::Null, |value| postgres_json_datetime(value).into())
}

impl Candidate {
    /// Every field, as `list_draft_candidates` returned it.
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "club": self.club,
            "ig_handle": self.ig_handle,
            "source_image_url": self.source_image_url,
            "category": self.category,
            "employers_on_campus": self.employers_on_campus,
            "price": self.price,
            "food": self.food,
            "registration": self.registration,
            "carousel_requested_at": timestamp(&self.carousel_requested_at),
            "dtstart_utc": postgres_json_datetime(&self.dtstart_utc),
            "dtend_utc": timestamp(&self.dtend_utc),
            "tz": self.tz,
        })
    }

    /// What the curation agent reads about the event (Python's `_EVENT_FIELDS`),
    /// in that order; the caller adds its poster.
    pub fn packet_summary(&self) -> Map<String, Value> {
        let full = self.to_json();
        [
            "id",
            "title",
            "club",
            "ig_handle",
            "category",
            "description",
            "location",
            "dtstart_utc",
            "dtend_utc",
            "tz",
            "price",
            "food",
            "registration",
            "carousel_requested_at",
        ]
        .into_iter()
        .map(|field| (field.to_owned(), full[field].clone()))
        .collect()
    }

    /// Whether a slide could show it: a known category and a poster.
    fn postable(&self) -> bool {
        self.category
            .as_deref()
            .is_some_and(|category| EVENT_CATEGORIES.contains(&python_strip(category)))
            && self
                .source_image_url
                .as_deref()
                .is_some_and(|url| !python_strip(url).is_empty())
    }
}

/// One school's packet (`list_draft_candidates`).
#[derive(Debug, Clone, PartialEq)]
pub struct Packet {
    pub account_key: String,
    pub publishing_connected: bool,
    pub requires_reauthorization: bool,
    pub local_date: NaiveDate,
    pub window_end: DateTime<Utc>,
    pub batch_id: Option<Uuid>,
    pub status: String,
    /// Only for a school with no draft today.
    pub open: Option<OpenPacket>,
}

/// What a school without a draft today chooses from.
#[derive(Debug, Clone, PartialEq)]
pub struct OpenPacket {
    pub window_start: DateTime<Utc>,
    pub caption_intro: String,
    pub events: Vec<Candidate>,
    pub excluded_clubs: Vec<String>,
}

impl Packet {
    pub fn to_json(&self) -> Value {
        let mut packet = json!({
            "account_key": self.account_key,
            "publishing_connected": self.publishing_connected,
            "requires_reauthorization": self.requires_reauthorization,
            "local_date": self.local_date.to_string(),
            "window_end": isoformat(&self.window_end),
            "batch_id": self.batch_id.map(|id| id.to_string()),
            "status": self.status,
        });
        if let (Some(open), Value::Object(fields)) = (&self.open, &mut packet) {
            fields.insert("window_start".into(), isoformat(&open.window_start).into());
            fields.insert("caption_intro".into(), open.caption_intro.clone().into());
            fields.insert(
                "events".into(),
                open.events.iter().map(Candidate::to_json).collect(),
            );
            fields.insert("excluded_clubs".into(), json!(open.excluded_clubs));
        }
        packet
    }
}

/// `_enabled_accounts`: one connected account that may publish.
#[derive(Debug, Clone, sqlx::FromRow)]
struct EnabledAccount {
    account_key: String,
    instagram_user_id: String,
    school_id: i64,
    requires_reauthorization: bool,
}

async fn enabled_accounts(db: &PgPool) -> Result<Vec<EnabledAccount>> {
    Ok(sqlx::query_as(
        "SELECT account_key, instagram_user_id, school_id::int8 AS school_id, \
         requires_reauthorization FROM public.instagram_publishing_accounts \
         WHERE enabled ORDER BY account_key",
    )
    .fetch_all(db)
    .await?)
}

/// `_daily_batch`: today's events draft for the account, if there is one.
async fn daily_batch(
    db: &PgPool,
    account_key: &str,
    local_date: NaiveDate,
) -> Result<Option<(Uuid, String)>> {
    Ok(sqlx::query_as(
        "SELECT id, status FROM public.instagram_publish_batches \
         WHERE account_key = $1 AND local_date = $2 AND batch_kind = $3 LIMIT 1",
    )
    .bind(account_key)
    .bind(local_date)
    .bind(KIND_EVENTS)
    .fetch_optional(db)
    .await?)
}

/// `_draft_window_start`: where the account's last successful carousel's
/// window ended, else `fallback_window_hours` ago.
async fn window_start(db: &PgPool, account_key: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let last: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT window_end FROM public.instagram_publish_batches \
         WHERE account_key = $1 AND batch_kind = $2 AND status = ANY($3) \
         ORDER BY window_end DESC LIMIT 1",
    )
    .bind(account_key)
    .bind(KIND_EVENTS)
    .bind(&[STATUS_READY_FOR_REVIEW, STATUS_PUBLISHED, STATUS_EMPTY][..])
    .fetch_optional(db)
    .await?;
    Ok(last.unwrap_or_else(|| now - Duration::hours(INSTAGRAM_PUBLISHING.fallback_window_hours)))
}

/// The school facts a caption needs, from its slug.
async fn caption_school(db: &PgPool, school: &str) -> Result<(String, Tz, bool)> {
    batches::caption_school(db, school).await.map_err(job_error)
}

/// `_excluded_club_handles`, sorted.
async fn excluded_clubs(db: &PgPool) -> Result<Vec<String>> {
    let mut handles: Vec<String> = batches::excluded_club_handles(db)
        .await
        .map_err(job_error)?
        .into_iter()
        .collect();
    handles.sort();
    Ok(handles)
}

/// `list_draft_candidates`: every registered school's packet for today,
/// read without writing anything.
pub async fn list_draft_candidates(db: &PgPool, now: DateTime<Utc>) -> Result<Vec<Packet>> {
    let local_date = local_date(now);
    let accounts: HashMap<String, EnabledAccount> = enabled_accounts(db)
        .await?
        .into_iter()
        .map(|account| (account.account_key.clone(), account))
        .collect();
    let excluded = excluded_clubs(db).await?;
    let schools: Vec<String> = sqlx::query_scalar("SELECT slug FROM public.schools ORDER BY slug")
        .fetch_all(db)
        .await?;
    let mut packets = Vec::new();
    for account_key in schools {
        let account = accounts.get(&account_key);
        let existing = daily_batch(db, &account_key, local_date).await?;
        let mut packet = Packet {
            account_key: account_key.clone(),
            publishing_connected: account.is_some(),
            requires_reauthorization: account
                .is_some_and(|account| account.requires_reauthorization),
            local_date,
            window_end: now,
            batch_id: existing.as_ref().map(|(id, _)| *id),
            status: existing
                .as_ref()
                .map_or(NEEDS_REVIEW.to_owned(), |(_, status)| status.clone()),
            open: None,
        };
        // An existing draft, even a failed one, stays the admin's.
        if existing.is_none() {
            let window_start = window_start(db, &account_key, now).await?;
            let (slug, timezone, french) = caption_school(db, &account_key).await?;
            packet.open = Some(OpenPacket {
                window_start,
                caption_intro: default_caption_intro(
                    &CaptionSchool {
                        slug: &slug,
                        timezone,
                        french,
                    },
                    KIND_EVENTS,
                ),
                events: draft_candidates(db, &account_key, window_start, now).await?,
                excluded_clubs: excluded.clone(),
            });
        }
        packets.push(packet);
    }
    Ok(packets)
}

/// When an occurrence must start for its event to make a carousel posted
/// `now`: at least `minimum_lead_hours` and at most `maximum_lead_days` away.
fn lead_window(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    (
        now + Duration::hours(INSTAGRAM_PUBLISHING.minimum_lead_hours),
        now + Duration::days(INSTAGRAM_PUBLISHING.maximum_lead_days),
    )
}

#[derive(sqlx::FromRow)]
struct Occurrence {
    event_id: i64,
    dtstart_utc: DateTime<Utc>,
    dtend_utc: Option<DateTime<Utc>>,
}

/// Each event's first occurrence in `occurrences` (already in order).
fn first_occurrences(occurrences: Vec<Occurrence>) -> HashMap<i64, Occurrence> {
    let mut first = HashMap::new();
    for occurrence in occurrences {
        first.entry(occurrence.event_id).or_insert(occurrence);
    }
    first
}

/// Of `ids`, the events this account has already posted.
async fn published_ids(db: &PgPool, account_key: &str, ids: &[i64]) -> Result<HashSet<i64>> {
    let ids: Vec<i32> = ids.iter().map(|id| *id as i32).collect();
    let rows: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT event_id::int8 FROM public.instagram_publish_items \
         WHERE account_key = $1 AND event_id = ANY($2) AND published_at IS NOT NULL",
    )
    .bind(account_key)
    .bind(&ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().collect())
}

/// `_draft_candidates`: the school's events added in the window, or asked for
/// in our DMs however long ago, that the account never posted and that have
/// a postable occurrence; soonest first, the newer event first on a tie.
pub async fn draft_candidates(
    db: &PgPool,
    account_key: &str,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Result<Vec<Candidate>> {
    let Some(school_id) = store::school_id(db, account_key).await.map_err(job_error)? else {
        return Ok(Vec::new());
    };
    // A club that asked to stay out of carousels never reaches Claude's picks.
    let events: Vec<Candidate> = sqlx::query_as(&format!(
        "SELECT {EVENT_COLUMNS} FROM public.events e \
         WHERE e.school_id = $1 AND e.cancelled = false AND NOT {excluded} \
           AND ((e.added_at >= $2 AND e.added_at < $3) OR e.carousel_requested_at IS NOT NULL) \
         ORDER BY e.added_at DESC, e.id",
        excluded = store::excluded_club!("e"),
    ))
    .bind(school_id as i32)
    .bind(window_start)
    .bind(window_end)
    .fetch_all(db)
    .await?;
    if events.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<i64> = events.iter().map(|event| event.id).collect();
    let published = published_ids(db, account_key, &ids).await?;
    let (from, to) = lead_window(window_end);
    let ids32: Vec<i32> = ids.iter().map(|id| *id as i32).collect();
    let occurrences: Vec<Occurrence> = sqlx::query_as(
        "SELECT event_id::int8 AS event_id, dtstart_utc, dtend_utc FROM public.event_dates \
         WHERE event_id = ANY($1) AND dtstart_utc >= $2 AND dtstart_utc <= $3 \
         ORDER BY dtstart_utc, id",
    )
    .bind(&ids32)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await?;
    let first = first_occurrences(occurrences);
    let tz = store::school_timezone(db, Some(account_key))
        .await
        .map_err(job_error)?;
    let mut candidates: Vec<Candidate> = events
        .into_iter()
        .filter(|event| !published.contains(&event.id) && event.postable())
        .filter_map(|event| {
            let occurrence = first.get(&event.id)?;
            Some(with_occurrence(event, occurrence, &tz))
        })
        .collect();
    candidates.sort_by_key(|event| (event.dtstart_utc, -event.id));
    Ok(candidates)
}

fn with_occurrence(event: Candidate, occurrence: &Occurrence, tz: &str) -> Candidate {
    Candidate {
        dtstart_utc: occurrence.dtstart_utc,
        dtend_utc: occurrence.dtend_utc,
        tz: tz.to_owned(),
        ..event
    }
}

/// What saving a draft did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The school already had a draft today; nothing was written.
    Existing,
    Saved,
    /// No picks: today is marked done with an empty batch.
    Empty,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Existing => "existing",
            Self::Saved => "saved",
            Self::Empty => "empty",
        }
    }
}

/// `save_review_draft`: check the choices against the school's candidates
/// as of the selection's `window_end`, then save them as today's draft.
/// A save that fails after its batch exists marks the batch failed.
pub async fn save_review_draft(db: &PgPool, selection: &DraftSelection) -> Result<(Outcome, Uuid)> {
    let now = selection.window_end;
    if now > Utc::now() {
        return Err(Refused("Draft window cannot end in the future".into()).into());
    }
    let account_key = selection.account_key.as_str();
    let account = enabled_accounts(db)
        .await?
        .into_iter()
        .find(|account| account.account_key == account_key);
    let Some(school_id) = store::school_id(db, account_key).await.map_err(job_error)? else {
        return Err(Refused("Instagram draft school is not registered".into()).into());
    };
    if account
        .as_ref()
        .is_some_and(|account| account.school_id != school_id)
    {
        return Err(
            Refused("Instagram publishing school does not match the account".into()).into(),
        );
    }
    let local_date = local_date(now);
    if let Some((id, _)) = daily_batch(db, account_key, local_date).await? {
        return Ok((Outcome::Existing, id));
    }
    let window_start = window_start(db, account_key, now).await?;
    let candidates = draft_candidates(db, account_key, window_start, now).await?;
    let candidate_ids: Vec<i64> = candidates.iter().map(|event| event.id).collect();
    validate_picks(&candidate_ids, &selection.picks).map_err(Refused)?;
    let selected: Vec<&Candidate> = selection
        .picks
        .iter()
        .filter_map(|pick| candidates.iter().find(|event| event.id == pick.event_id))
        .collect();
    let batch_id: Uuid = sqlx::query_scalar(
        "INSERT INTO public.instagram_publish_batches (account_key, batch_kind, \
             instagram_user_id, school_id, local_date, window_start, window_end, status, \
             caption_intro, cover_body) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
    )
    .bind(account_key)
    .bind(KIND_EVENTS)
    .bind(
        account
            .as_ref()
            .map(|account| account.instagram_user_id.as_str()),
    )
    .bind(school_id as i32)
    .bind(local_date)
    .bind(window_start)
    .bind(now)
    .bind(STATUS_GENERATING)
    .bind(&selection.caption_intro)
    .bind(&selection.cover_body)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| anyhow!("Could not create Instagram draft for {account_key}"))?;
    if let Err(error) = fill_draft(db, batch_id, account_key, selection, &selected).await {
        tracing::error!("Instagram draft save failed for account={account_key}: {error:#}");
        sqlx::query(
            "UPDATE public.instagram_publish_batches \
             SET status = $2, error_message = $3, updated_at = now() WHERE id = $1",
        )
        .bind(batch_id)
        .bind(STATUS_FAILED)
        .bind(error_message(&error))
        .execute(db)
        .await?;
        return Err(error);
    }
    let outcome = if selected.is_empty() {
        Outcome::Empty
    } else {
        Outcome::Saved
    };
    Ok((outcome, batch_id))
}

/// The new batch's slides, caption and stickers, or its empty mark.
async fn fill_draft(
    db: &PgPool,
    batch_id: Uuid,
    account_key: &str,
    selection: &DraftSelection,
    selected: &[&Candidate],
) -> Result<()> {
    if selected.is_empty() {
        sqlx::query(
            "UPDATE public.instagram_publish_batches \
             SET status = $2, error_message = NULL, updated_at = now() WHERE id = $1",
        )
        .bind(batch_id)
        .bind(STATUS_EMPTY)
        .execute(db)
        .await?;
        return Ok(());
    }
    let event_ids: Vec<i32> = selected.iter().map(|event| event.id as i32).collect();
    sqlx::query(
        "INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position) \
         SELECT $1, $2, event_id, position::int4 \
         FROM unnest($3::int4[]) WITH ORDINALITY AS slides (event_id, position)",
    )
    .bind(batch_id)
    .bind(account_key)
    .bind(&event_ids)
    .execute(db)
    .await?;
    let (slug, timezone, french) = caption_school(db, account_key).await?;
    let entries: Vec<CaptionEvent<'_>> = selected
        .iter()
        .map(|event| CaptionEvent {
            title: &event.title,
            club: event.club.as_deref(),
            ig_handle: event.ig_handle.as_deref(),
            location: event.location.as_deref(),
            start: event.dtstart_utc,
        })
        .collect();
    let caption = build_caption(
        &entries,
        &CaptionSchool {
            slug: &slug,
            timezone,
            french,
        },
        &selection.caption_intro,
    )
    .map_err(job_error)?;
    let stickers: Map<String, Value> = selection
        .picks
        .iter()
        .map(|pick| (pick.event_id.to_string(), json!(pick.sticker_labels)))
        .collect();
    sqlx::query(
        "UPDATE public.instagram_publish_batches SET status = $2, caption = $3, \
         sticker_selections = $4, error_message = NULL, updated_at = now() WHERE id = $1",
    )
    .bind(batch_id)
    .bind(STATUS_READY_FOR_REVIEW)
    .bind(caption)
    .bind(Value::Object(stickers))
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn candidate(id: i64) -> Candidate {
        Candidate {
            id,
            title: "Film night".into(),
            description: Some("A film".into()),
            location: Some("SLC".into()),
            club: Some("Film Club".into()),
            ig_handle: None,
            source_image_url: Some("https://media.test/17.jpg".into()),
            category: Some("Arts & Culture".into()),
            employers_on_campus: None,
            price: Some(json!(5)),
            food: Some(json!([])),
            registration: false,
            carousel_requested_at: None,
            dtstart_utc: Utc.with_ymd_and_hms(2026, 9, 29, 22, 0, 0).unwrap(),
            dtend_utc: None,
            tz: "America/Toronto".into(),
        }
    }

    #[test]
    fn the_agent_reads_the_packet_fields_in_their_order() {
        let summary = candidate(17).packet_summary();
        assert_eq!(
            summary.keys().collect::<Vec<_>>(),
            [
                "id",
                "title",
                "club",
                "ig_handle",
                "category",
                "description",
                "location",
                "dtstart_utc",
                "dtend_utc",
                "tz",
                "price",
                "food",
                "registration",
                "carousel_requested_at"
            ]
        );
        assert_eq!(summary["dtstart_utc"], "2026-09-29T22:00:00+00:00");
        assert_eq!(summary["price"], json!(5));
        // test_codex_reads_candidates_without_writing
        assert!(!summary.contains_key("allowed_sticker_labels"));
    }

    #[test]
    fn only_categorized_events_with_posters_are_postable() {
        // test_load_candidates_requires_images_and_categories_from_any_source
        assert!(candidate(1).postable());
        for category in [None, Some(""), Some("Events")] {
            let event = Candidate {
                category: category.map(str::to_owned),
                ..candidate(1)
            };
            assert!(!event.postable());
        }
        let blank = Candidate {
            source_image_url: Some("  ".into()),
            ..candidate(1)
        };
        assert!(!blank.postable());
        let padded = Candidate {
            category: Some(" Business ".into()),
            ..candidate(1)
        };
        assert!(padded.postable());
    }

    #[test]
    fn drafts_are_dated_in_toronto() {
        // test_publish_ready_drafts_publishes_todays_drafts_one_by_one
        let at = Utc.with_ymd_and_hms(2026, 11, 6, 14, 35, 0).unwrap();
        assert_eq!(local_date(at).to_string(), "2026-11-06");
        let late = Utc.with_ymd_and_hms(2026, 11, 7, 3, 0, 0).unwrap();
        assert_eq!(local_date(late).to_string(), "2026-11-06");
    }

    #[test]
    fn packets_carry_their_events_only_while_open() {
        let now = Utc.with_ymd_and_hms(2026, 9, 28, 14, 0, 0).unwrap();
        let closed = Packet {
            account_key: "uwaterloo".into(),
            publishing_connected: true,
            requires_reauthorization: true,
            local_date: local_date(now),
            window_end: now,
            batch_id: None,
            status: NEEDS_REVIEW.into(),
            open: None,
        };
        // test_codex_existing_packets_do_not_reselect_events
        assert!(closed.to_json().get("events").is_none());
        let open = Packet {
            open: Some(OpenPacket {
                window_start: now - Duration::hours(24),
                caption_intro: "Campus picks".into(),
                events: vec![candidate(17)],
                excluded_clubs: vec!["v1vaclub".into()],
            }),
            ..closed
        };
        let json = open.to_json();
        assert_eq!(json["window_start"], "2026-09-27T14:00:00+00:00");
        assert_eq!(json["events"][0]["id"], 17);
        assert_eq!(json["excluded_clubs"], json!(["v1vaclub"]));
        assert_eq!(json["requires_reauthorization"], true);
    }
}
