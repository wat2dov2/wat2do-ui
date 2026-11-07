//! Carousel batches as the admin editor sees them: the list, one batch with
//! its live slides, the editor's saves and the publish claim
//! (`services/instagram_publishing/service.py`).
//!
//! A batch stores which events are on the carousel, in order, plus the copy
//! an admin writes; everything a slide shows is read live from the events,
//! so a draft never shows stale event data. The daily drafts and the
//! scheduled publish (`crate::instagram_publishing`, binary
//! `wat2do-instagram`) read and claim batches through these same functions.

use std::collections::{HashMap, HashSet};
use std::process::Stdio;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use indexmap::IndexMap;
use serde::{Serialize, Serializer};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::captions::{CaptionEvent, CaptionSchool, build_caption};
use super::credentials::load_account_credentials;
use crate::api::errors::ApiError;
use crate::api::events::model::Event;
use crate::api::events::store;
use crate::api::json;
use crate::api::messages::{
    INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE, INSTAGRAM_PUBLISH_BATCH_NOT_FOUND,
    INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT,
};
use crate::api::pagination::Pagination;
use crate::constants::EVENT_CATEGORIES;
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::db::read_with_retry;
use crate::text::python_strip;
use crate::time_zones::Tz;

pub const STATUS_GENERATING: &str = "generating";
pub const STATUS_READY_FOR_REVIEW: &str = "ready_for_review";
pub const STATUS_PUBLISHING: &str = "publishing";
pub const STATUS_PUBLISHED: &str = "published";
pub const STATUS_EMPTY: &str = "empty";
pub const STATUS_FAILED: &str = "failed";
/// `InstagramPublishBatchStatus`.
pub const STATUSES: &[&str] = &[
    STATUS_GENERATING,
    STATUS_READY_FOR_REVIEW,
    STATUS_PUBLISHING,
    STATUS_PUBLISHED,
    STATUS_EMPTY,
    STATUS_FAILED,
];
/// The daily drafts' kind; employer carousels are only ever read.
pub const KIND_EVENTS: &str = "events";
const KIND_EMPLOYERS: &str = "employers_on_campus";
/// The outro is listed without an editor, so it leaves out whole categories
/// the carousel never posts.
const OUTRO_HIDDEN_CATEGORIES: [&str; 2] = ["Politics & Advocacy", "Religion & Spirituality"];

/// The binary that publishes a claimed batch (`wat2do-instagram
/// publish-batch <id>`): it renders the slides, uploads them and posts the
/// carousel through Meta's Graph API, the same code the scheduled publish
/// runs. It sits beside `wat2do-api` (the release's `bin/`, or cargo's
/// target folder) and starts from the API's working directory (`backend/`),
/// with the API's environment.
const PUBLISH_BINARY: &str = "wat2do-instagram";
const PUBLISH_COMMAND: &str = "publish-batch";

/// `InstagramPublishBatchBaseResponse`, in its field order, plus what the
/// reads need (`school_id`, the stored sticker choices).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BatchRow {
    pub id: Uuid,
    pub account_key: String,
    pub instagram_user_id: Option<String>,
    pub batch_kind: String,
    pub school: String,
    pub local_date: NaiveDate,
    #[serde(serialize_with = "json::datetime")]
    pub window_start: DateTime<Utc>,
    #[serde(serialize_with = "json::datetime")]
    pub window_end: DateTime<Utc>,
    pub status: String,
    pub caption: String,
    pub caption_intro: String,
    pub cover_body: String,
    pub version: i32,
    pub error_message: Option<String>,
    pub meta_media_id: Option<String>,
    pub permalink: Option<String>,
    pub music_status: Option<String>,
    pub music_track: Option<String>,
    pub music_error: Option<String>,
    pub published_cover_url: Option<String>,
    pub published_outro_url: Option<String>,
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "json::datetime")]
    pub updated_at: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub published_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub school_id: i32,
    #[serde(skip)]
    pub sticker_selections: Value,
}

/// The columns of a `BatchRow`, `b` being the batch.
const BATCH_COLUMNS: &str = "b.id, b.account_key, b.instagram_user_id, b.batch_kind, \
     s.slug AS school, b.local_date, b.window_start, b.window_end, b.status, b.caption, \
     b.caption_intro, b.cover_body, b.version, b.error_message, b.meta_media_id, b.permalink, \
     b.music_status, b.music_track, b.music_error, b.published_cover_url, b.published_outro_url, \
     b.created_at, b.updated_at, b.published_at, b.school_id, b.sticker_selections";

impl BatchRow {
    fn editable(&self) -> bool {
        is_editable(&self.status)
    }

    /// The stored sticker choices (`dict[str, list[str]]`).
    fn stored_stickers(&self) -> Result<IndexMap<String, Vec<String>>, ApiError> {
        serde_json::from_value(self.sticker_selections.clone()).map_err(|error| {
            ApiError::Internal(anyhow::anyhow!(
                "batch {} sticker selections: {error}",
                self.id
            ))
        })
    }
}

fn is_editable(status: &str) -> bool {
    status == STATUS_READY_FOR_REVIEW || status == STATUS_FAILED
}

/// One `instagram_publish_items` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ItemRow {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub account_key: String,
    pub event_id: Option<i32>,
    pub position: i32,
    pub published_asset_url: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ItemRow {
    fn event_id(&self) -> Option<i64> {
        self.event_id.map(i64::from)
    }

    fn has_published_asset(&self) -> bool {
        self.published_asset_url
            .as_deref()
            .is_some_and(|url| !url.is_empty())
    }
}

/// A slide: its item and the event it shows today.
#[derive(Debug, Clone)]
pub struct Item {
    pub row: ItemRow,
    pub event: Option<Event>,
}

/// `InstagramPublishItemResponse`.
#[derive(Serialize)]
struct ItemResponse<'a> {
    id: Uuid,
    batch_id: Uuid,
    account_key: &'a str,
    event_id: Option<i32>,
    position: i32,
    #[serde(serialize_with = "option_summary")]
    event: &'a Option<Event>,
    published_asset_url: &'a Option<String>,
    #[serde(serialize_with = "json::option_datetime")]
    published_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::datetime")]
    created_at: DateTime<Utc>,
    #[serde(serialize_with = "json::datetime")]
    updated_at: DateTime<Utc>,
}

fn option_summary<S: Serializer>(event: &Option<Event>, serializer: S) -> Result<S::Ok, S::Error> {
    match event {
        Some(event) => event.summary().serialize(serializer),
        None => serializer.serialize_none(),
    }
}

fn summaries<S: Serializer>(events: &[Event], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_seq(events.iter().map(Event::summary))
}

/// A hydrated batch (`InstagramPublishBatchResponse`).
#[derive(Debug, Clone)]
pub struct Batch {
    pub row: BatchRow,
    pub sticker_selections: IndexMap<String, Vec<String>>,
    pub new_event_count: i64,
    pub other_events: Vec<Event>,
    pub items: Vec<Item>,
}

impl Serialize for Batch {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Response<'a> {
            #[serde(flatten)]
            row: &'a BatchRow,
            sticker_selections: &'a IndexMap<String, Vec<String>>,
            new_event_count: i64,
            #[serde(serialize_with = "summaries")]
            other_events: &'a [Event],
            items: Vec<ItemResponse<'a>>,
        }
        Response {
            row: &self.row,
            sticker_selections: &self.sticker_selections,
            new_event_count: self.new_event_count,
            other_events: &self.other_events,
            items: self
                .items
                .iter()
                .map(|item| ItemResponse {
                    id: item.row.id,
                    batch_id: item.row.batch_id,
                    account_key: &item.row.account_key,
                    event_id: item.row.event_id,
                    position: item.row.position,
                    event: &item.event,
                    published_asset_url: &item.row.published_asset_url,
                    published_at: item.row.published_at,
                    created_at: item.row.created_at,
                    updated_at: item.row.updated_at,
                })
                .collect(),
        }
        .serialize(serializer)
    }
}

/// `InstagramPublishBatchSummaryResponse`: a list row with its slide counts.
#[derive(Debug, Serialize)]
pub struct BatchSummary {
    #[serde(flatten)]
    pub row: BatchRow,
    pub item_count: i64,
    pub eligible_count: i64,
}

// ── Eligibility and the slide events ────────────────────────────────────────

/// `_is_publishable_event`: a category, a poster, not over, and for an
/// employer carousel an employers-on-campus event.
pub fn is_publishable(event: &Event, now: DateTime<Utc>, batch_kind: &str) -> bool {
    event
        .category
        .as_deref()
        .is_some_and(|category| EVENT_CATEGORIES.contains(&python_strip(category)))
        && event
            .source_image_url
            .as_deref()
            .is_some_and(|url| !python_strip(url).is_empty())
        && !event.has_ended(now)
        && (batch_kind != KIND_EMPLOYERS || event.employers_on_campus == Some(true))
}

/// `_load_slide_events`: the live events behind `ids`, leaving out events
/// without a date (a slide has nowhere to print one).
async fn slide_events(db: &PgPool, ids: &[i64]) -> Result<HashMap<i64, Event>, ApiError> {
    let mut events = store::events_by_ids(db, ids).await?;
    events.retain(|_, event| !event.occurrences.is_empty());
    Ok(events)
}

/// `_club_handle`.
fn club_handle(handle: Option<&str>) -> String {
    python_strip(handle.unwrap_or_default())
        .trim_start_matches('@')
        .to_lowercase()
}

/// The school facts `build_caption` reads.
pub(crate) async fn caption_school(
    db: &PgPool,
    school: &str,
) -> Result<(String, Tz, bool), ApiError> {
    let slug = crate::schools::normalize_slug(school);
    let zone = store::school_timezone(db, Some(&slug)).await?;
    let timezone: Tz = zone
        .parse()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("ZoneInfo has no zone {zone:?}")))?;
    let language: Option<String> = read_with_retry(|| {
        sqlx::query_scalar("SELECT language FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(&slug)
            .fetch_optional(db)
    })
    .await?;
    Ok((slug, timezone, language.as_deref() == Some("fr")))
}

/// `build_caption` for these slide events, in order.
async fn caption_for(
    db: &PgPool,
    events: &[&Event],
    school: &str,
    intro: &str,
) -> Result<String, ApiError> {
    let (slug, timezone, french) = caption_school(db, school).await?;
    let entries: Vec<CaptionEvent<'_>> = events
        .iter()
        .filter_map(|event| CaptionEvent::of(event))
        .collect();
    build_caption(
        &entries,
        &CaptionSchool {
            slug: &slug,
            timezone,
            french,
        },
        intro,
    )
}

// ── Reads ───────────────────────────────────────────────────────────────────

async fn load_row(db: &PgPool, batch_id: Uuid) -> Result<Option<BatchRow>, ApiError> {
    let sql = format!(
        "SELECT {BATCH_COLUMNS} FROM public.instagram_publish_batches b \
         JOIN public.schools s ON s.id = b.school_id WHERE b.id = $1 LIMIT 1"
    );
    Ok(read_with_retry(|| {
        sqlx::query_as::<_, BatchRow>(&sql)
            .bind(batch_id)
            .fetch_optional(db)
    })
    .await?)
}

/// `_load_batch_items`: every item of these batches, by position.
async fn load_items(db: &PgPool, batch_ids: &[Uuid]) -> Result<Vec<ItemRow>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_as::<_, ItemRow>(
            "SELECT id, batch_id, account_key, event_id, position, published_asset_url, \
             published_at, created_at, updated_at FROM public.instagram_publish_items \
             WHERE batch_id = ANY($1) ORDER BY position, id",
        )
        .bind(batch_ids)
        .fetch_all(db)
    })
    .await?)
}

/// `_excluded_club_handles`: clubs that asked to stay out of carousels.
pub(crate) async fn excluded_club_handles(db: &PgPool) -> Result<HashSet<String>, ApiError> {
    let handles: Vec<String> = read_with_retry(|| {
        sqlx::query_scalar("SELECT ig_handle FROM public.instagram_excluded_clubs").fetch_all(db)
    })
    .await?;
    Ok(handles.into_iter().collect())
}

/// `_recent_event_ids`: the school's active events added in the window that
/// ends at the batch's fixed `window_end`.
async fn recent_event_ids(db: &PgPool, row: &BatchRow) -> Result<HashSet<i64>, ApiError> {
    let start = row.window_end
        - Duration::try_hours(INSTAGRAM_PUBLISHING.new_event_window_hours).unwrap_or_default();
    let ids: Vec<i64> = read_with_retry(|| {
        sqlx::query_scalar(
            "SELECT id::int8 FROM public.events WHERE school_id = $1 AND cancelled = false \
             AND added_at >= $2 AND added_at < $3 AND (NOT $4 OR employers_on_campus = true)",
        )
        .bind(row.school_id)
        .bind(start)
        .bind(row.window_end)
        .bind(row.batch_kind == KIND_EMPLOYERS)
        .fetch_all(db)
    })
    .await?;
    Ok(ids.into_iter().collect())
}

/// `_summarize_recent_events`: the cover's event count, and for a batch not
/// yet posted the window's upcoming events without a slide (the outro).
async fn summarize_recent(
    db: &PgPool,
    row: &BatchRow,
    items: &[ItemRow],
) -> Result<(i64, Vec<Event>), ApiError> {
    let recent = recent_event_ids(db, row).await?;
    let carousel: HashSet<i64> = items.iter().filter_map(ItemRow::event_id).collect();
    let new_event_count = recent.len().max(carousel.len()) as i64;
    if !(is_editable(&row.status) || row.status == STATUS_PUBLISHING) {
        return Ok((new_event_count, Vec::new()));
    }
    let now = Utc::now();
    let excluded = excluded_club_handles(db).await?;
    let mut others: Vec<i64> = recent.difference(&carousel).copied().collect();
    others.sort_unstable();
    let others = slide_events(db, &others).await?;
    Ok((new_event_count, outro_events(others, &excluded, now)))
}

/// The outro's events: still upcoming or ongoing, not from a club that
/// opted out, not in a category the carousel never posts; soonest first.
fn outro_events(
    events: HashMap<i64, Event>,
    excluded: &HashSet<String>,
    now: DateTime<Utc>,
) -> Vec<Event> {
    let mut others: Vec<Event> = events
        .into_values()
        .filter(|event| {
            !event.has_ended(now)
                && !excluded.contains(&club_handle(event.ig_handle.as_deref()))
                && !event
                    .category
                    .as_deref()
                    .is_some_and(|category| OUTRO_HIDDEN_CATEGORIES.contains(&category))
        })
        .collect();
    others.sort_by_key(|event| (event.occurrences[0].dtstart_utc, event.id));
    others
}

/// The slides a batch shows: a draft only the ones it could still post, a
/// posted batch every slide whose event still exists, plus the images it
/// posted for events deleted since.
fn visible_items(
    row: &BatchRow,
    items: Vec<ItemRow>,
    events: &HashMap<i64, Event>,
    now: DateTime<Utc>,
) -> Vec<Item> {
    let editable = row.editable();
    items
        .into_iter()
        .filter_map(|item| {
            let event = item.event_id().and_then(|id| events.get(&id).cloned());
            let eligible = event
                .as_ref()
                .is_some_and(|event| is_publishable(event, now, &row.batch_kind));
            let kept = (event.is_some() && (!editable || eligible))
                || (row.status == STATUS_PUBLISHED && item.has_published_asset());
            kept.then_some(Item { row: item, event })
        })
        .collect()
}

/// A draft's stickers: only its slides', at most `maximum_stickers_per_event` each.
fn draft_stickers(
    stored: &IndexMap<String, Vec<String>>,
    items: &[Item],
) -> IndexMap<String, Vec<String>> {
    let maximum = INSTAGRAM_PUBLISHING.maximum_stickers_per_event;
    items
        .iter()
        .filter_map(|item| {
            let key = item.row.event_id?.to_string();
            let mut labels = stored.get(&key)?.clone();
            labels.truncate(maximum);
            Some((key, labels))
        })
        .collect()
}

/// `_hydrate_batch`: the slides with their live events, the cover count and
/// outro events, and for a draft its current caption and stickers.
async fn hydrate(db: &PgPool, row: BatchRow) -> Result<Batch, ApiError> {
    let items = load_items(db, &[row.id]).await?;
    let ids: Vec<i64> = items.iter().filter_map(ItemRow::event_id).collect();
    let (events, (new_event_count, other_events)) =
        tokio::try_join!(slide_events(db, &ids), summarize_recent(db, &row, &items))?;
    let items = visible_items(&row, items, &events, Utc::now());
    let mut sticker_selections = row.stored_stickers()?;
    let mut row = row;
    if row.editable() {
        sticker_selections = draft_stickers(&sticker_selections, &items);
        let slides: Vec<&Event> = items
            .iter()
            .filter_map(|item| item.event.as_ref())
            .collect();
        row.caption = caption_for(db, &slides, &row.school, &row.caption_intro).await?;
    }
    Ok(Batch {
        row,
        sticker_selections,
        new_event_count,
        other_events,
        items,
    })
}

/// `get_batch`.
pub async fn get_batch(db: &PgPool, batch_id: Uuid) -> Result<Batch, ApiError> {
    let row = load_row(db, batch_id)
        .await?
        .ok_or_else(|| ApiError::not_found(INSTAGRAM_PUBLISH_BATCH_NOT_FOUND))?;
    hydrate(db, row).await
}

/// `list_batches`: a page of event carousels, newest day first, each with
/// how many slides it has and how many could still be posted.
pub async fn list_batches(
    db: &PgPool,
    status: Option<&str>,
    local_date: Option<NaiveDate>,
    pagination: Pagination,
) -> Result<(Vec<BatchSummary>, i64), ApiError> {
    const FILTER: &str = "b.batch_kind = 'events' AND ($1::text IS NULL OR b.status = $1) \
                          AND ($2::date IS NULL OR b.local_date = $2)";
    let count = format!("SELECT count(*) FROM public.instagram_publish_batches b WHERE {FILTER}");
    let total: i64 = read_with_retry(|| {
        sqlx::query_scalar(&count)
            .bind(status)
            .bind(local_date)
            .fetch_one(db)
    })
    .await?;
    let sql = format!(
        "SELECT {BATCH_COLUMNS} FROM public.instagram_publish_batches b \
         JOIN public.schools s ON s.id = b.school_id WHERE {FILTER} \
         ORDER BY b.local_date DESC, b.created_at DESC LIMIT $3 OFFSET $4"
    );
    let rows: Vec<BatchRow> = read_with_retry(|| {
        sqlx::query_as(&sql)
            .bind(status)
            .bind(local_date)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .fetch_all(db)
    })
    .await?;
    let batches = with_item_counts(db, rows).await?;
    let total = if total > 0 {
        total
    } else {
        batches.len() as i64
    };
    Ok((batches, total))
}

/// `_attach_item_counts`: slides (with an event or a posted image) and
/// slides that could still be posted, per batch.
async fn with_item_counts(db: &PgPool, rows: Vec<BatchRow>) -> Result<Vec<BatchSummary>, ApiError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let items = load_items(db, &ids).await?;
    let mut event_ids: Vec<i64> = items.iter().filter_map(ItemRow::event_id).collect();
    event_ids.sort_unstable();
    event_ids.dedup();
    let events = slide_events(db, &event_ids).await?;
    let counts = item_counts(&rows, &items, &events, Utc::now());
    Ok(rows
        .into_iter()
        .map(|row| {
            let (item_count, eligible_count) = counts.get(&row.id).copied().unwrap_or_default();
            BatchSummary {
                row,
                item_count,
                eligible_count,
            }
        })
        .collect())
}

/// Per batch: (slides with an event or a posted image, slides that could still be posted).
fn item_counts(
    rows: &[BatchRow],
    items: &[ItemRow],
    events: &HashMap<i64, Event>,
    now: DateTime<Utc>,
) -> HashMap<Uuid, (i64, i64)> {
    let kinds: HashMap<Uuid, &str> = rows
        .iter()
        .map(|row| (row.id, row.batch_kind.as_str()))
        .collect();
    let mut counts: HashMap<Uuid, (i64, i64)> = HashMap::new();
    for item in items {
        let count = counts.entry(item.batch_id).or_default();
        if item.event_id.is_some() || item.has_published_asset() {
            count.0 += 1;
        }
        let eligible = item
            .event_id()
            .and_then(|id| events.get(&id))
            .is_some_and(|event| is_publishable(event, now, kinds[&item.batch_id]));
        if eligible {
            count.1 += 1;
        }
    }
    counts
}

// ── Writes ──────────────────────────────────────────────────────────────────

fn assert_version(batch: &Batch, expected: i64) -> Result<(), ApiError> {
    if i64::from(batch.row.version) != expected {
        return Err(ApiError::conflict(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT));
    }
    Ok(())
}

fn assert_editable(batch: &Batch) -> Result<(), ApiError> {
    if !batch.row.editable() {
        return Err(ApiError::validation(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE));
    }
    Ok(())
}

/// `InstagramPublishBatchUpdate`, validated.
#[derive(Debug, PartialEq)]
pub struct DraftUpdate {
    pub version: i64,
    pub caption_intro: String,
    pub cover_body: String,
    pub event_ids: Vec<i64>,
}

/// `update_instagram_publish_batch_draft`'s exceptions, as `_raise_draft_update_error` maps them.
fn draft_update_error(error: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(database_error) = &error {
        let message = database_error.message().to_lowercase();
        if message.contains("version conflict") {
            return ApiError::conflict(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT);
        }
        if message.contains("not found") {
            return ApiError::not_found(INSTAGRAM_PUBLISH_BATCH_NOT_FOUND);
        }
        if message.contains("not editable") {
            return ApiError::validation(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE);
        }
    }
    ApiError::Database(error)
}

/// `update_batch`: save the carousel the editor holds (its events, in
/// order, plus its copy) under the batch's version lock.
pub async fn update_batch(
    db: &PgPool,
    batch_id: Uuid,
    update: DraftUpdate,
) -> Result<Batch, ApiError> {
    let batch = get_batch(db, batch_id).await?;
    assert_version(&batch, update.version)?;
    assert_editable(&batch)?;
    let ids = &update.event_ids;
    if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err(ApiError::validation(
            "Every carousel slide must be a different event",
        ));
    }
    let events = slide_events(db, ids).await?;
    let Some(slides) = ids
        .iter()
        .map(|id| events.get(id))
        .collect::<Option<Vec<&Event>>>()
    else {
        return Err(ApiError::validation(
            "Every carousel slide must be a dated, existing event",
        ));
    };
    if batch.row.batch_kind == KIND_EMPLOYERS
        && slides
            .iter()
            .any(|event| event.employers_on_campus != Some(true))
    {
        return Err(ApiError::validation(
            "Employer carousels only accept employers-on-campus events",
        ));
    }
    let now = Utc::now();
    let invalid: Vec<String> = slides
        .iter()
        .filter(|event| !is_publishable(event, now, KIND_EVENTS))
        .map(|event| event.id.to_string())
        .collect();
    if !invalid.is_empty() {
        return Err(ApiError::validation(format!(
            "Cannot add or save event IDs: {}. Each event needs a valid category, a poster image, and an upcoming or ongoing occurrence.",
            invalid.join(", ")
        )));
    }
    let caption = caption_for(db, &slides, &batch.row.school, &update.caption_intro).await?;
    let event_ids: Vec<i32> = slides.iter().map(|event| event.id as i32).collect();
    let saved: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM public.update_instagram_publish_batch_draft($1, $2, $3, $4, $5, $6) LIMIT 1",
    )
    .bind(batch_id)
    .bind(update.version as i32)
    .bind(&caption)
    .bind(&update.caption_intro)
    .bind(&update.cover_body)
    .bind(&event_ids)
    .fetch_optional(db)
    .await
    .map_err(draft_update_error)?;
    if saved.is_none() {
        return Err(ApiError::conflict(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT));
    }
    get_batch(db, batch_id).await
}

/// `_enabled_accounts`, for one account: whether it may publish.
async fn account_enabled(db: &PgPool, account_key: &str) -> Result<bool, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM public.instagram_publishing_accounts \
             WHERE enabled AND account_key = $1)",
        )
        .bind(account_key)
        .fetch_one(db)
    })
    .await?)
}

/// `claim_batch_for_publishing`: check the draft can be posted, then lock it
/// against edits as `publishing` (one claim wins under the version lock).
/// The slides that will not be posted leave the batch in the same
/// transaction, so it holds exactly what is then published.
pub async fn claim_batch(
    db: &PgPool,
    encryption_key: &str,
    batch_id: Uuid,
    version: i64,
) -> Result<Batch, ApiError> {
    let batch = get_batch(db, batch_id).await?;
    assert_version(&batch, version)?;
    assert_editable(&batch)?;
    let account_key = batch.row.account_key.as_str();
    if !account_enabled(db, account_key).await? {
        return Err(ApiError::validation(
            "Connect and enable an Instagram account for this school before publishing",
        ));
    }
    let instagram_user_id = load_account_credentials(db, encryption_key, account_key, Utc::now())
        .await?
        .instagram_user_id;
    if batch
        .row
        .instagram_user_id
        .as_deref()
        .is_some_and(|bound| !bound.is_empty() && bound != instagram_user_id)
    {
        return Err(ApiError::validation(
            "Instagram account credentials no longer match this batch",
        ));
    }
    let slides = batch.items.len();
    if slides == 0 {
        return Err(ApiError::validation(
            "Instagram publishing batch has no publishable slides",
        ));
    }
    let control = &*INSTAGRAM_PUBLISHING;
    if slides < control.minimum_event_slides {
        return Err(ApiError::validation(format!(
            "Choose at least {} event slides before publishing",
            control.minimum_event_slides
        )));
    }
    if slides > control.maximum_event_slides {
        return Err(ApiError::validation(format!(
            "Choose at most {} event slides before publishing",
            control.maximum_event_slides
        )));
    }
    let selected: Vec<i32> = batch
        .items
        .iter()
        .filter_map(|item| item.row.event_id)
        .collect();
    let mut transaction = db.begin().await?;
    let claimed: Option<BatchRow> = sqlx::query_as(&format!(
        "WITH claimed AS ( \
             UPDATE public.instagram_publish_batches SET status = '{STATUS_PUBLISHING}', \
                 instagram_user_id = $3, caption = $4, error_message = NULL, \
                 version = $2 + 1, updated_at = $5 \
             WHERE id = $1 AND version = $2 \
               AND status IN ('{STATUS_READY_FOR_REVIEW}', '{STATUS_FAILED}') \
             RETURNING *) \
         SELECT {BATCH_COLUMNS} FROM claimed b JOIN public.schools s ON s.id = b.school_id"
    ))
    .bind(batch_id)
    .bind(version as i32)
    .bind(&instagram_user_id)
    .bind(&batch.row.caption)
    .bind(Utc::now())
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(claimed) = claimed else {
        return Err(ApiError::conflict(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT));
    };
    sqlx::query(
        "DELETE FROM public.instagram_publish_items WHERE batch_id = $1 AND published_at IS NULL \
         AND (event_id IS NULL OR NOT event_id = ANY($2))",
    )
    .bind(batch_id)
    .bind(&selected)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    // The claimed row replaces the draft's fields, its stored stickers included.
    let sticker_selections = claimed.stored_stickers()?;
    Ok(Batch {
        row: claimed,
        sticker_selections,
        ..batch
    })
}

/// Where the publishing binary is: beside this process's own executable.
fn publish_binary() -> std::io::Result<std::path::PathBuf> {
    Ok(std::env::current_exe()?.with_file_name(PUBLISH_BINARY))
}

/// Publish a claimed batch from a detached `wat2do-instagram` process, as
/// the scheduled publish does; the request does not wait for Instagram.
/// The job records a failed publish on the batch itself; a process that
/// cannot start, or dies before it could, fails the batch here.
pub fn publish_in_background(db: PgPool, batch_id: Uuid) {
    let spawned = publish_binary().and_then(|binary| {
        tokio::process::Command::new(binary)
            .args([PUBLISH_COMMAND, &batch_id.to_string()])
            .stdin(Stdio::null())
            // Its own process group, so restarting the API never cuts a post short.
            .process_group(0)
            .kill_on_drop(false)
            .spawn()
    });
    tokio::spawn(async move {
        let failure = match spawned {
            Err(error) => Some(format!("Could not start publishing: {error}")),
            Ok(mut child) => match child.wait().await {
                Ok(status) if status.success() => None,
                Ok(status) => Some(format!("Publishing stopped unexpectedly ({status})")),
                Err(error) => Some(format!("Publishing could not be watched: {error}")),
            },
        };
        let Some(message) = failure else { return };
        tracing::error!("Instagram batch {batch_id} failed to publish: {message}");
        let marked = sqlx::query(&format!(
            "UPDATE public.instagram_publish_batches SET status = '{STATUS_FAILED}', \
             error_message = $2, updated_at = now() WHERE id = $1 AND status = '{STATUS_PUBLISHING}'"
        ))
        .bind(batch_id)
        .bind(&message)
        .execute(&db)
        .await;
        if let Err(error) = marked {
            tracing::error!("Could not record that batch {batch_id} failed: {error}");
        }
    });
}

#[cfg(test)]
mod tests;
