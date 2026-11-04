//! Event reads in as few round trips as possible, with the same rows,
//! order and limits the PostgREST reads in `event_query`, `event_service`
//! and `event_date_service` returned.
//!
//! Two PostgREST limits shape the results and are kept on purpose:
//! - every top-level read returns at most `POSTGREST_MAX_ROWS` (1000) rows,
//!   so the filtered feed scans only its first 1000 occurrence rows and a
//!   batch of events carries at most 1000 occurrences in all;
//! - occurrences of one event are ordered by `dtstart_utc` alone, so the
//!   occurrence query keeps PostgREST's shape (`event_id = ANY(..) ORDER BY
//!   dtstart_utc LIMIT 1000`) and Postgres orders ties the same way.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, LocalResult, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::feed::CandidateEvent;
use super::model::{ClubCohost, Event, EventRow, Occurrence, hydrate, needs_directory_logo};
use crate::api::errors::ApiError;
use crate::db::read_with_retry;
use crate::text::{casefold, python_strip};

/// PostgREST's `db-max-rows` in production.
pub const POSTGREST_MAX_ROWS: i64 = 1000;
/// `event_date_service` and `_load_event_rows_by_ids` batch ids by 500.
const ID_BATCH: usize = 500;
/// How long school lookups, directory sources and directory logos are
/// reused (Python cached them for the process; Rust refreshes them).
fn lookup_ttl() -> Duration {
    Duration::from_secs_f64(crate::controlbox::CLUB_MANAGEMENT.school_lookup_cache_seconds)
}

// ── Schools (the lookups `school_service` and `school_context` make) ───────

/// A registered school.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct School {
    pub id: i64,
    pub slug: String,
    pub timezone: String,
}

/// Found schools only, so anonymous `school=` values cannot grow the cache;
/// at most this many spellings are kept.
const SCHOOL_CACHE_ENTRIES: usize = 256;

type SchoolCache = Mutex<HashMap<(bool, String), (Instant, School)>>;
static SCHOOLS: LazyLock<SchoolCache> = LazyLock::new(|| Mutex::new(HashMap::new()));

async fn cached_school(
    db: &PgPool,
    by_name: bool,
    key: String,
) -> Result<Option<School>, ApiError> {
    let ttl = lookup_ttl();
    if let Some((at, school)) = SCHOOLS
        .lock()
        .expect("school cache")
        .get(&(by_name, key.clone()))
        && at.elapsed() < ttl
    {
        return Ok(Some(school.clone()));
    }
    let school = if by_name {
        let pattern = key.clone();
        read_with_retry(|| {
            sqlx::query_as::<_, School>(
                "SELECT id::int8 AS id, slug, timezone FROM public.schools WHERE name ILIKE $1 LIMIT 1",
            )
            .bind(&pattern)
            .fetch_optional(db)
        })
        .await?
    } else {
        read_with_retry(|| {
            sqlx::query_as::<_, School>(
                "SELECT id::int8 AS id, slug, timezone FROM public.schools WHERE slug = $1 LIMIT 1",
            )
            .bind(&key)
            .fetch_optional(db)
        })
        .await?
    };
    if let Some(found) = &school {
        let mut cache = SCHOOLS.lock().expect("school cache");
        if cache.len() >= SCHOOL_CACHE_ENTRIES {
            cache.retain(|_, (at, _)| at.elapsed() < ttl);
            if cache.len() >= SCHOOL_CACHE_ENTRIES {
                cache.clear();
            }
        }
        cache.insert((by_name, key), (Instant::now(), found.clone()));
    }
    Ok(school)
}

/// `school_service.get_school`: by slug (stripped, lower-cased).
pub async fn school_by_slug(db: &PgPool, value: &str) -> Result<Option<School>, ApiError> {
    let slug = crate::schools::normalize_slug(value);
    if slug.is_empty() {
        return Ok(None);
    }
    cached_school(db, false, slug).await
}

/// `school_service.get_school_id`: by slug, else by name.
pub async fn school_id(db: &PgPool, value: &str) -> Result<Option<i64>, ApiError> {
    if let Some(school) = school_by_slug(db, value).await? {
        return Ok(Some(school.id));
    }
    let Some(pattern) = crate::schools::name_pattern(value) else {
        return Ok(None);
    };
    Ok(cached_school(db, true, pattern)
        .await?
        .map(|school| school.id))
}

/// `school_context.resolve_school_timezone`: the slug's zone, else UTC.
pub async fn school_timezone(db: &PgPool, school: Option<&str>) -> Result<String, ApiError> {
    let Some(school) = school.filter(|school| !python_strip(school).is_empty()) else {
        return Ok("UTC".to_owned());
    };
    match school_by_slug(db, school).await? {
        Some(found) => Ok(found.timezone),
        None => {
            tracing::warn!(
                "Unknown school slug {:?} in timezone lookup; falling back to UTC",
                school
            );
            Ok("UTC".to_owned())
        }
    }
}

/// `event_service._today_start_utc`: local midnight of today in `zone`, as
/// `datetime.now(tz).replace(hour=0, ...)` resolves it (the earlier offset
/// for an ambiguous or skipped midnight).
pub fn today_start_utc(zone: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>, ApiError> {
    let tz: Tz = zone
        .parse()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("ZoneInfo has no zone {zone:?}")))?;
    let midnight = now.with_timezone(&tz).date_naive().and_time(NaiveTime::MIN);
    let local = match tz.from_local_datetime(&midnight) {
        LocalResult::Single(at) | LocalResult::Ambiguous(at, _) => at,
        LocalResult::None => {
            // fold=0 in a gap: the offset in force before the transition.
            let before = tz
                .from_local_datetime(&(midnight - chrono::Duration::hours(3)))
                .earliest()
                .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("no offset for {zone}")))?;
            let seconds = chrono::Offset::fix(before.offset()).local_minus_utc();
            return Ok((midnight - chrono::Duration::seconds(i64::from(seconds))).and_utc());
        }
    };
    Ok(local.with_timezone(&Utc))
}

// ── Hydrated events ─────────────────────────────────────────────────────

/// Microseconds since the epoch of a timestamptz column, exactly.
macro_rules! micros {
    ($column:expr) => {
        concat!("(extract(epoch FROM ", $column, ") * 1000000)::int8")
    };
}

/// One hydrated event as JSON (`json_build_object` takes at most 100 arguments).
const EVENT_OBJECT: &str = concat!(
    "json_build_object(",
    "'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, ",
    "'location', e.location, 'map_location', e.map_location, 'map_coordinates', e.map_coordinates, ",
    "'price', e.price, 'food', e.food, 'registration', e.registration, ",
    "'source_image_url', e.source_image_url, 'source_video_url', e.source_video_url, ",
    "'source_url', e.source_url, 'category', e.category, 'club', e.club, 'ig_handle', e.ig_handle, ",
    "'cancelled', e.cancelled, 'added_at', ",
    micros!("e.added_at"),
    ", 'last_source_changed_at', ",
    micros!("e.last_source_changed_at"),
    ", 'competition', e.competition, 'employers_on_campus', e.employers_on_campus, ",
    "'sports_game', e.sports_game, 'campus_season_ids', e.campus_season_ids, ",
    "'ingestion_source', e.ingestion_source, 'created_by', e.created_by, ",
    "'school', NULLIF(s.slug, ''), 'school_timezone', s.timezone, ",
    "'has_club', c.id IS NOT NULL, 'club_logo_url', c.logo_url, 'club_type', c.club_type, ",
    "'club_page', c.club_page, 'club_ig', c.ig, 'club_discord', c.discord, ",
    "'cohosts', COALESCE((SELECT json_agg(json_build_object('id', h.id, 'club_name', h.club_name, ",
    "'logo_url', h.logo_url, 'club_type', h.club_type, 'club_page', h.club_page, 'ig', h.ig, ",
    "'discord', h.discord) ORDER BY h.id) FROM public.clubs h WHERE h.id = ANY(e.cohost_club_ids)), '[]'), ",
    "'featured', f.event_id IS NOT NULL, ",
    "'occurrences', COALESCE(o.occurrences, '[]'))"
);

/// CTEs that hydrate the events of a `page(id int8, ord int8)` CTE the caller
/// defines first, ending in `events_json(events)`: a JSON list in `ord` order.
const HYDRATE_CTES: &str = concat!(
    // PostgREST's occurrence read: one batch, at most 1000 rows, by start only.
    "occ AS MATERIALIZED (SELECT row_number() OVER () AS rn, o.* FROM (",
    "SELECT d.id, d.event_id, d.dtstart_utc, d.dtend_utc, d.duration, d.tz FROM public.event_dates d ",
    "WHERE d.event_id = ANY(ARRAY(SELECT page.id::int4 FROM page)) ORDER BY d.dtstart_utc LIMIT 1000) o), ",
    "occ_by_event AS (SELECT occ.event_id, json_agg(json_build_object('id', occ.id, 'event_id', occ.event_id, ",
    "'dtstart_utc', ",
    micros!("occ.dtstart_utc"),
    ", 'dtend_utc', ",
    micros!("occ.dtend_utc"),
    ", 'duration', occ.duration, 'tz', occ.tz) ORDER BY occ.rn) AS occurrences FROM occ GROUP BY occ.event_id), ",
    "featured AS (SELECT DISTINCT i.event_id FROM public.instagram_publish_items i ",
    "JOIN public.instagram_publish_batches b ON b.id = i.batch_id ",
    "WHERE i.event_id = ANY(ARRAY(SELECT page.id::int4 FROM page)) AND (i.published_at IS NOT NULL OR b.status = 'published')), ",
    "events_json AS (SELECT COALESCE(json_agg(",
);

const HYDRATE_FROM: &str = concat!(
    " ORDER BY page.ord), '[]') AS events FROM page ",
    "JOIN public.events e ON e.id = page.id ",
    "JOIN public.schools s ON s.id = e.school_id ",
    "LEFT JOIN public.clubs c ON c.id = e.club_id ",
    "LEFT JOIN featured f ON f.event_id = e.id ",
    "LEFT JOIN occ_by_event o ON o.event_id = e.id)"
);

/// `WITH {page_ctes}, <hydration>`: the full CTE list for a statement whose
/// `page_ctes` define `page(id, ord)`.
pub fn with_hydration(page_ctes: &str) -> String {
    format!("WITH {page_ctes}, {HYDRATE_CTES}{EVENT_OBJECT}{HYDRATE_FROM}")
}

#[derive(Debug, Deserialize)]
struct OccurrenceJson {
    id: Uuid,
    event_id: i64,
    dtstart_utc: i64,
    dtend_utc: Option<i64>,
    duration: Option<String>,
    tz: Option<String>,
}

fn from_micros(micros: i64) -> Result<DateTime<Utc>, ApiError> {
    DateTime::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("timestamp out of range: {micros}")))
}

impl OccurrenceJson {
    fn into_occurrence(self) -> Result<Occurrence, ApiError> {
        Ok(Occurrence {
            id: self.id,
            event_id: self.event_id,
            dtstart_utc: from_micros(self.dtstart_utc)?,
            dtend_utc: self.dtend_utc.map(from_micros).transpose()?,
            duration: self.duration,
            tz: self.tz,
        })
    }
}

#[derive(Debug, Deserialize)]
struct EventJson {
    id: i64,
    club_id: Option<i64>,
    title: String,
    description: Option<String>,
    location: Option<String>,
    map_location: Option<String>,
    map_coordinates: Option<Vec<Option<f64>>>,
    price: Option<f64>,
    food: Option<serde_json::Value>,
    registration: bool,
    source_image_url: Option<String>,
    source_video_url: Option<String>,
    source_url: Option<String>,
    category: Option<String>,
    club: Option<String>,
    ig_handle: Option<String>,
    cancelled: bool,
    added_at: i64,
    last_source_changed_at: Option<i64>,
    competition: Option<bool>,
    employers_on_campus: Option<bool>,
    sports_game: Option<bool>,
    campus_season_ids: Option<Vec<Option<String>>>,
    ingestion_source: Option<String>,
    created_by: Option<Uuid>,
    school: Option<String>,
    school_timezone: Option<String>,
    has_club: bool,
    club_logo_url: Option<String>,
    club_type: Option<String>,
    club_page: Option<String>,
    club_ig: Option<String>,
    club_discord: Option<String>,
    cohosts: Vec<ClubCohost>,
    featured: bool,
    occurrences: Vec<OccurrenceJson>,
}

impl EventJson {
    fn split(self) -> Result<(EventRow, Vec<Occurrence>), ApiError> {
        let occurrences = self
            .occurrences
            .into_iter()
            .map(OccurrenceJson::into_occurrence)
            .collect::<Result<Vec<_>, _>>()?;
        let row = EventRow {
            id: self.id,
            club_id: self.club_id,
            title: self.title,
            description: self.description,
            location: self.location,
            map_location: self.map_location,
            map_coordinates: self.map_coordinates,
            price: self.price,
            food: self.food,
            registration: self.registration,
            source_image_url: self.source_image_url,
            source_video_url: self.source_video_url,
            source_url: self.source_url,
            category: self.category,
            club: self.club,
            ig_handle: self.ig_handle,
            cancelled: self.cancelled,
            added_at: from_micros(self.added_at)?,
            last_source_changed_at: self.last_source_changed_at.map(from_micros).transpose()?,
            competition: self.competition,
            employers_on_campus: self.employers_on_campus,
            sports_game: self.sports_game,
            campus_season_ids: self.campus_season_ids,
            ingestion_source: self.ingestion_source,
            created_by: self.created_by,
            school: self.school,
            school_timezone: self.school_timezone,
            has_club: self.has_club,
            club_logo_url: self.club_logo_url,
            club_type: self.club_type,
            club_page: self.club_page,
            club_ig: self.club_ig,
            club_discord: self.club_discord,
            cohosts: self.cohosts,
            featured: self.featured,
        };
        Ok((row, occurrences))
    }
}

/// Hydrate the `events` JSON a `with_hydration` statement returned, in order.
pub async fn hydrate_json(db: &PgPool, events: serde_json::Value) -> Result<Vec<Event>, ApiError> {
    let parsed: Vec<EventJson> = serde_json::from_value(events)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("event JSON: {error}")))?;
    let rows = parsed
        .into_iter()
        .map(EventJson::split)
        .collect::<Result<Vec<_>, _>>()?;
    let wanted: Vec<(Option<String>, Option<String>)> = rows
        .iter()
        .filter(|(row, _)| {
            needs_directory_logo(
                row.ingestion_source.as_deref() == Some("directory"),
                row.club_id,
                row.club_logo_url.as_deref(),
            )
        })
        .map(|(row, _)| (row.school.clone(), row.source_url.clone()))
        .collect();
    let logos = directory_logos(db, &wanted).await?;
    rows.into_iter()
        .map(|(row, occurrences)| {
            let logo = logos
                .get(&(row.school.clone(), row.source_url.clone()))
                .cloned()
                .flatten();
            hydrate(row, occurrences, logo)
        })
        .collect()
}

/// `_load_hydrated_events_by_ids`: hydrated events by id, batched by 500 ids
/// like PostgREST reads (each batch's occurrences capped at 1000 rows).
pub async fn events_by_ids(db: &PgPool, ids: &[i64]) -> Result<HashMap<i64, Event>, ApiError> {
    let mut found = HashMap::new();
    let sql = format!(
        "{} SELECT events FROM events_json",
        with_hydration(
            "page AS (SELECT DISTINCT ON (given.id) given.id, given.ord FROM \
             unnest($1::int8[]) WITH ORDINALITY AS given(id, ord) ORDER BY given.id, given.ord)"
        )
    );
    for batch in ids.chunks(ID_BATCH) {
        let events: serde_json::Value =
            read_with_retry(|| sqlx::query_scalar(&sql).bind(batch).fetch_one(db)).await?;
        for event in hydrate_json(db, events).await? {
            found.insert(event.id, event);
        }
    }
    Ok(found)
}

/// `event_service.get_event`: one hydrated event, or `None`.
pub async fn event_by_id(db: &PgPool, id: i64) -> Result<Option<Event>, ApiError> {
    Ok(events_by_ids(db, &[id]).await?.remove(&id))
}

// ── Directory default logos (`directory.default_club_logo`) ─────────────────

#[derive(Debug, Clone, sqlx::FromRow)]
struct DirectorySource {
    school: Option<String>,
    url: String,
    default_club_ig: Option<String>,
}

/// Like Python's process caches (`_sources_by_school`, `_get_clubs_for_school_lookup`),
/// but refreshed: the directory sources, and each school handle's logo.
type Cached<T> = Mutex<Option<(Instant, T)>>;
static DIRECTORY_SOURCES: LazyLock<Cached<Vec<DirectorySource>>> =
    LazyLock::new(|| Mutex::new(None));
type LogoCache = Mutex<HashMap<(String, String), (Instant, Option<String>)>>;
static HANDLE_LOGOS: LazyLock<LogoCache> = LazyLock::new(|| Mutex::new(HashMap::new()));

async fn directory_sources(db: &PgPool) -> Result<Vec<DirectorySource>, ApiError> {
    let ttl = lookup_ttl();
    if let Some((at, sources)) = DIRECTORY_SOURCES.lock().expect("source cache").as_ref()
        && at.elapsed() < ttl
    {
        return Ok(sources.clone());
    }
    let sources: Vec<DirectorySource> = read_with_retry(|| {
        sqlx::query_as::<_, DirectorySource>(
            "SELECT NULLIF(s.slug, '') AS school, ds.url, ds.default_club_ig \
             FROM public.directory_sources ds JOIN public.schools s ON s.id = ds.school_id ORDER BY ds.id",
        )
        .fetch_all(db)
    })
    .await?;
    *DIRECTORY_SOURCES.lock().expect("source cache") = Some((Instant::now(), sources.clone()));
    Ok(sources)
}

/// `urlsplit(url).hostname`, lower-cased, without a leading `www.`.
pub fn url_host(url: &str) -> String {
    let url: String = url
        .trim_start_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\r' | '\n'))
        .collect();
    let rest = match url.find(':') {
        Some(index)
            if index > 0
                && url.as_bytes()[0].is_ascii_alphabetic()
                && url[..index]
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.')) =>
        {
            &url[index + 1..]
        }
        _ => url.as_str(),
    };
    let Some(after) = rest.strip_prefix("//") else {
        return String::new();
    };
    let netloc = &after[..after.find(['/', '?', '#']).unwrap_or(after.len())];
    let hostinfo = netloc.rsplit_once('@').map_or(netloc, |(_, host)| host);
    let host = if let Some(bracketed) = hostinfo.strip_prefix('[') {
        bracketed.split(']').next().unwrap_or_default()
    } else {
        hostinfo.split(':').next().unwrap_or_default()
    };
    let host = host.to_lowercase();
    host.strip_prefix("www.").map(str::to_owned).unwrap_or(host)
}

/// The logo of each directory's publishing club, for `(school, source_url)` pairs.
async fn directory_logos(
    db: &PgPool,
    wanted: &[(Option<String>, Option<String>)],
) -> Result<HashMap<(Option<String>, Option<String>), Option<String>>, ApiError> {
    let mut logos = HashMap::new();
    if wanted.is_empty() {
        return Ok(logos);
    }
    let sources = directory_sources(db).await?;
    for (school, source_url) in wanted {
        if logos.contains_key(&(school.clone(), source_url.clone())) {
            continue;
        }
        let school_sources: Vec<&DirectorySource> = sources
            .iter()
            .filter(|source| {
                source.school.as_deref().unwrap_or_default()
                    == school.as_deref().unwrap_or_default()
            })
            .collect();
        let logo = match school_sources.first() {
            None => None,
            Some(first) => {
                let host = url_host(source_url.as_deref().unwrap_or_default());
                let source = school_sources
                    .iter()
                    .find(|source| url_host(&source.url) == host)
                    .unwrap_or(first);
                match (
                    source.school.as_deref(),
                    source
                        .default_club_ig
                        .as_deref()
                        .filter(|ig| !ig.is_empty()),
                ) {
                    (Some(slug), Some(handle)) => club_logo_by_handle(db, slug, handle).await?,
                    _ => None,
                }
            }
        };
        logos.insert((school.clone(), source_url.clone()), logo);
    }
    Ok(logos)
}

/// `club_service.lookup_club_by_school_and_ig`: the one club of the school
/// with this Instagram handle, else none.
async fn club_logo_by_handle(
    db: &PgPool,
    slug: &str,
    handle: &str,
) -> Result<Option<String>, ApiError> {
    let key = (slug.to_owned(), handle.to_owned());
    let ttl = lookup_ttl();
    if let Some((at, logo)) = HANDLE_LOGOS.lock().expect("logo cache").get(&key)
        && at.elapsed() < ttl
    {
        return Ok(logo.clone());
    }
    let normalize = |value: &str| casefold(python_strip(value).trim_start_matches('@'));
    let target = normalize(handle);
    let logo = match school_id(db, slug).await? {
        None => None,
        Some(school_id) => {
            let rows: Vec<(Option<String>, Option<String>)> = read_with_retry(|| {
                sqlx::query_as(
                    "SELECT ig, logo_url FROM public.clubs WHERE school_id = $1 \
                     AND strpos(lower(ig), lower($2)) > 0 ORDER BY id",
                )
                .bind(school_id)
                .bind(target.as_str())
                .fetch_all(db)
            })
            .await?;
            let matches: Vec<&(Option<String>, Option<String>)> = rows
                .iter()
                .filter(|(ig, _)| normalize(ig.as_deref().unwrap_or_default()) == target)
                .collect();
            match matches.as_slice() {
                [(_, logo)] => logo.clone(),
                _ => None,
            }
        }
    };
    HANDLE_LOGOS
        .lock()
        .expect("logo cache")
        .insert(key, (Instant::now(), logo.clone()));
    Ok(logo)
}

// ── The feed ────────────────────────────────────────────────────────────

/// What the default date-ordered feed (`_load_lightweight_date_page`) reads.
#[derive(Debug, Clone, Default)]
pub struct DateWindow {
    pub start_utc: Option<DateTime<Utc>>,
    pub end_utc: Option<DateTime<Utc>>,
    pub school_id: Option<i64>,
}

/// One feed statement's results: the page, the total, and the newest event.
#[derive(Debug)]
pub struct FeedPage {
    pub events: Vec<Event>,
    pub total: i64,
    pub latest: Option<LatestAdded>,
}

/// `LatestAddedItem`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LatestAdded {
    pub title: String,
    #[serde(serialize_with = "crate::api::json::datetime")]
    pub added_at: DateTime<Utc>,
    pub club_name: Option<String>,
    pub club_logo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LatestJson {
    title: String,
    added_at: i64,
    club_name: Option<String>,
    club_logo_url: Option<String>,
}

/// `get_latest_added_event`'s condition: the event still has an occurrence on
/// or ahead (an end in the future, or no end and a start within
/// `event_without_end_visibility_minutes`), since selecting it searches the
/// feed, which hides ended events.
fn not_ended_sql() -> String {
    format!(
        "EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = e.id \
         AND (d.dtend_utc >= now() OR (d.dtend_utc IS NULL \
         AND d.dtstart_utc >= now() - make_interval(mins => {}))))",
        crate::controlbox::EVENT_DISCOVERY.event_without_end_visibility_minutes
    )
}

/// `get_latest_added_event`'s scalar subquery; `$school` is its school id parameter.
fn latest_sql(school_parameter: Option<&str>) -> String {
    // The newest event first, then its club (PostgREST's embed), so the club
    // join never runs over every event.
    let not_ended = not_ended_sql();
    let newest = match school_parameter {
        Some(parameter) => format!(
            "SELECT e.title, e.added_at, e.club_id FROM public.events e \
             WHERE e.school_id = {parameter} AND {not_ended} ORDER BY e.added_at DESC LIMIT 1"
        ),
        // Across schools, each school's newest through its (school_id, added_at)
        // index instead of reading every event; ties go to the lowest row
        // position, the row Postgres' full scan keeps.
        None => format!(
            "SELECT newest_of_school.title, newest_of_school.added_at, newest_of_school.club_id \
             FROM public.schools s CROSS JOIN LATERAL (SELECT e.title, e.added_at, e.club_id, e.ctid \
             FROM public.events e WHERE e.school_id = s.id AND {not_ended} \
             ORDER BY e.added_at DESC, e.ctid LIMIT 1) \
             newest_of_school ORDER BY newest_of_school.added_at DESC, newest_of_school.ctid LIMIT 1"
        ),
    };
    format!(
        "(SELECT json_build_object('title', newest.title, 'added_at', {}, 'club_name', c.club_name, \
         'club_logo_url', c.logo_url) FROM ({newest}) newest LEFT JOIN public.clubs c ON c.id = newest.club_id)",
        micros!("newest.added_at")
    )
}

fn parse_latest(value: Option<serde_json::Value>) -> Result<Option<LatestAdded>, ApiError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let latest: LatestJson = serde_json::from_value(value)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("latest event JSON: {error}")))?;
    Ok(Some(LatestAdded {
        title: latest.title,
        added_at: from_micros(latest.added_at)?,
        club_name: latest.club_name,
        club_logo_url: latest.club_logo_url,
    }))
}

/// `get_latest_added_event` alone (for a feed that needed no other read).
pub async fn latest_added(
    db: &PgPool,
    school_id: Option<i64>,
) -> Result<Option<LatestAdded>, ApiError> {
    let sql = format!("SELECT {}", latest_sql(school_id.map(|_| "$1")));
    let value: Option<serde_json::Value> = read_with_retry(|| {
        let mut query = sqlx::query_scalar(&sql);
        if let Some(id) = school_id {
            query = query.bind(id);
        }
        query.fetch_one(db)
    })
    .await?;
    parse_latest(value)
}

/// Parameters bound in order; SQL refers to them as `$1`, `$2`, ...
#[derive(Default)]
struct Binds {
    values: Vec<Bind>,
}

enum Bind {
    Int(i64),
    Ints(Vec<i64>),
    Float(f64),
    Bool(bool),
    Time(DateTime<Utc>),
    Texts(Vec<String>),
    Text(String),
}

impl Binds {
    fn push(&mut self, value: Bind) -> String {
        self.values.push(value);
        format!("${}", self.values.len())
    }

    fn apply<'q>(
        &'q self,
        mut query: sqlx::query::QueryScalar<
            'q,
            sqlx::Postgres,
            serde_json::Value,
            sqlx::postgres::PgArguments,
        >,
    ) -> sqlx::query::QueryScalar<'q, sqlx::Postgres, serde_json::Value, sqlx::postgres::PgArguments>
    {
        for value in &self.values {
            query = match value {
                Bind::Int(value) => query.bind(*value),
                Bind::Ints(values) => query.bind(values.as_slice()),
                Bind::Float(value) => query.bind(*value),
                Bind::Bool(value) => query.bind(*value),
                Bind::Time(value) => query.bind(*value),
                Bind::Texts(values) => query.bind(values.as_slice()),
                Bind::Text(value) => query.bind(value.as_str()),
            };
        }
        query
    }
}

fn window_conditions(window: &DateWindow, binds: &mut Binds) -> Vec<String> {
    let mut conditions = vec!["TRUE".to_owned()];
    if let Some(start) = window.start_utc {
        conditions.push(format!(
            "d.dtstart_utc >= {}",
            binds.push(Bind::Time(start))
        ));
    }
    if let Some(end) = window.end_utc {
        conditions.push(format!("d.dtstart_utc <= {}", binds.push(Bind::Time(end))));
    }
    if let Some(school_id) = window.school_id {
        conditions.push(format!(
            "e.school_id = {}",
            binds.push(Bind::Int(school_id))
        ));
    }
    conditions
}

/// The default feed in one statement: the exact total, the page of events in
/// first-occurrence order (`_load_lightweight_date_page`), and, on page one,
/// the school's newest event.
pub async fn date_page(
    db: &PgPool,
    window: &DateWindow,
    offset: i64,
    limit: i64,
    cap: i64,
    with_latest: bool,
) -> Result<FeedPage, ApiError> {
    let mut binds = Binds::default();
    let conditions = window_conditions(window, &mut binds).join(" AND ");
    // `_load_lightweight_date_page_ids`: the first `cap * 5` rows in feed
    // order, deduped to `cap` events, sliced to the page.
    let required = cap.min(offset + limit);
    let take = (required - offset).max(0);
    let scan = binds.push(Bind::Int(cap * 5));
    let offset_parameter = binds.push(Bind::Int(offset));
    let take_parameter = binds.push(Bind::Int(take));
    let latest = if with_latest {
        let school = window.school_id.map(|id| binds.push(Bind::Int(id)));
        latest_sql(school.as_deref())
    } else {
        "NULL::json".to_owned()
    };
    // Every occurrence has its event (a foreign key), so only a school
    // filter needs the events table.
    let join = if window.school_id.is_some() {
        "JOIN public.events e ON e.id = d.event_id "
    } else {
        ""
    };
    let page_ctes = format!(
        "matching AS MATERIALIZED (SELECT d.event_id, d.dtstart_utc, d.id FROM public.event_dates d \
         {join}WHERE {conditions}), \
         firsts AS (SELECT scanned.event_id, min(scanned.dtstart_utc) AS first_start FROM \
         (SELECT matching.event_id, matching.dtstart_utc FROM matching \
         ORDER BY matching.dtstart_utc, matching.event_id, matching.id LIMIT {scan}) scanned \
         GROUP BY scanned.event_id), \
         page AS (SELECT firsts.event_id::int8 AS id, row_number() OVER (ORDER BY firsts.first_start, firsts.event_id) AS ord \
         FROM firsts ORDER BY firsts.first_start, firsts.event_id OFFSET {offset_parameter} LIMIT {take_parameter})"
    );
    let sql = format!(
        "{} SELECT json_build_array((SELECT count(DISTINCT matching.event_id) FROM matching), \
         (SELECT events FROM events_json), {latest})",
        with_hydration(&page_ctes)
    );
    let result: serde_json::Value =
        read_with_retry(|| binds.apply(sqlx::query_scalar(&sql)).fetch_one(db)).await?;
    let [total, events, latest]: [serde_json::Value; 3] = serde_json::from_value(result)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("feed JSON: {error}")))?;
    Ok(FeedPage {
        events: hydrate_json(db, events).await?,
        total: total.as_i64().unwrap_or_default(),
        latest: parse_latest(Some(latest))?,
    })
}

/// The filters the filtered feed pushes into Postgres (`load_events_page`).
#[derive(Debug, Clone, Default)]
pub struct ScanFilters {
    pub window: DateWindow,
    /// `ids` (and `club_ids`) narrow the scan to these events.
    pub event_ids: Option<Vec<i64>>,
    /// Each club must host or cohost the event (`_load_club_event_ids`).
    pub club_ids: Vec<i64>,
    pub added_since: Option<DateTime<Utc>>,
    pub categories: Vec<String>,
    /// Sanitized club name terms, each matched with `ilike %term%`.
    pub club_terms: Vec<String>,
    pub registration: Option<bool>,
    pub min_price: Option<f64>,
    pub max_price: Option<f64>,
}

/// The filtered feed's scan: the first 1000 occurrence rows in feed order and
/// the fields of their events.
pub async fn scan(
    db: &PgPool,
    filters: &ScanFilters,
) -> Result<(Vec<super::feed::ScannedRow>, HashMap<i64, CandidateEvent>), ApiError> {
    let mut binds = Binds::default();
    let mut conditions = window_conditions(&filters.window, &mut binds);
    if let Some(ids) = &filters.event_ids {
        conditions.push(format!(
            "d.event_id = ANY({}::int8[])",
            binds.push(Bind::Ints(ids.clone()))
        ));
    }
    for club_id in &filters.club_ids {
        let parameter = binds.push(Bind::Int(*club_id));
        conditions.push(format!(
            "(e.club_id = {parameter} OR e.cohost_club_ids @> ARRAY[{parameter}::int4])"
        ));
    }
    if let Some(since) = filters.added_since {
        conditions.push(format!("e.added_at >= {}", binds.push(Bind::Time(since))));
    }
    if !filters.categories.is_empty() {
        conditions.push(format!(
            "e.category = ANY({}::text[])",
            binds.push(Bind::Texts(filters.categories.clone()))
        ));
    }
    for term in &filters.club_terms {
        conditions.push(format!(
            "public.club_names(e) ILIKE {}",
            binds.push(Bind::Text(format!("%{term}%")))
        ));
    }
    if let Some(registration) = filters.registration {
        conditions.push(format!(
            "e.registration = {}",
            binds.push(Bind::Bool(registration))
        ));
    }
    if let Some(price) = filters.min_price {
        conditions.push(format!("e.price >= {}", binds.push(Bind::Float(price))));
    }
    if let Some(price) = filters.max_price {
        conditions.push(format!("e.price <= {}", binds.push(Bind::Float(price))));
    }
    let sql = format!(
        "WITH scanned AS MATERIALIZED (SELECT row_number() OVER () AS rn, rows.* FROM (\
         SELECT d.event_id, d.dtstart_utc FROM public.event_dates d JOIN public.events e ON e.id = d.event_id \
         WHERE {} ORDER BY d.dtstart_utc, d.event_id, d.id LIMIT {POSTGREST_MAX_ROWS}) rows) \
         SELECT json_build_array(\
         (SELECT COALESCE(json_agg(json_build_array(scanned.event_id, {}) ORDER BY scanned.rn), '[]') FROM scanned), \
         (SELECT COALESCE(json_agg(json_build_object('id', e.id, 'title', e.title, 'description', e.description, \
         'location', e.location, 'club', e.club, 'ig_handle', e.ig_handle, 'food', e.food, 'price', e.price, \
         'added_at', {}, 'timezone', s.timezone)), '[]') \
         FROM public.events e JOIN public.schools s ON s.id = e.school_id \
         WHERE e.id IN (SELECT scanned.event_id FROM scanned)))",
        conditions.join(" AND "),
        micros!("scanned.dtstart_utc"),
        micros!("e.added_at"),
    );
    let result: serde_json::Value =
        read_with_retry(|| binds.apply(sqlx::query_scalar(&sql)).fetch_one(db)).await?;
    let (rows, events): (Vec<(i64, i64)>, Vec<CandidateEvent>) = serde_json::from_value(result)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("scan JSON: {error}")))?;
    let rows = rows
        .into_iter()
        .map(|(event_id, start)| {
            Ok(super::feed::ScannedRow {
                event_id,
                dtstart_utc: from_micros(start)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok((
        rows,
        events.into_iter().map(|event| (event.id, event)).collect(),
    ))
}

/// Hydrate a chosen page of event ids in order, with page one's newest event.
pub async fn page_of(
    db: &PgPool,
    ids: &[i64],
    latest_for: Option<Option<i64>>,
) -> Result<(Vec<Event>, Option<LatestAdded>), ApiError> {
    let mut binds = Binds::default();
    let ids_parameter = binds.push(Bind::Ints(ids.to_vec()));
    let latest = match latest_for {
        Some(school_id) => {
            let school = school_id.map(|id| binds.push(Bind::Int(id)));
            latest_sql(school.as_deref())
        }
        None => "NULL::json".to_owned(),
    };
    let sql = format!(
        "{} SELECT json_build_array((SELECT events FROM events_json), {latest})",
        with_hydration(&format!(
            "page AS (SELECT given.id, given.ord FROM unnest({ids_parameter}::int8[]) WITH ORDINALITY AS given(id, ord))"
        ))
    );
    let result: serde_json::Value =
        read_with_retry(|| binds.apply(sqlx::query_scalar(&sql)).fetch_one(db)).await?;
    let [events, latest]: [serde_json::Value; 2] = serde_json::from_value(result)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("page JSON: {error}")))?;
    Ok((hydrate_json(db, events).await?, parse_latest(Some(latest))?))
}

/// `load_upcoming_event_ids`: up to `cap` event ids with an occurrence at or
/// after `since`, in first-occurrence order.
pub async fn upcoming_ids(
    db: &PgPool,
    since: DateTime<Utc>,
    school_id: i64,
    cap: i64,
) -> Result<Vec<i64>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, i64>(
            "SELECT firsts.event_id::int8 FROM (SELECT scanned.event_id, min(scanned.dtstart_utc) AS first_start \
             FROM (SELECT d.event_id, d.dtstart_utc FROM public.event_dates d JOIN public.events e ON e.id = d.event_id \
             WHERE d.dtstart_utc >= $1 AND e.school_id = $2 ORDER BY d.dtstart_utc, d.event_id, d.id LIMIT $3) scanned \
             GROUP BY scanned.event_id) firsts ORDER BY firsts.first_start, firsts.event_id LIMIT $4",
        )
        .bind(since)
        .bind(school_id)
        .bind(cap * 5)
        .bind(cap)
        .fetch_all(db)
    })
    .await?)
}

/// One count RPC (`get_event_click_counts` or `get_event_going_counts`)
/// over these events: event id to count.
async fn counts(
    db: &PgPool,
    function: &str,
    ids: &[i64],
) -> Result<HashMap<i64, i64>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT event_id::int8, count::int8 FROM public.{function}($1::int8[]::int4[]) AS rows(event_id, count)"
    );
    let rows: Vec<(i64, i64)> =
        read_with_retry(|| sqlx::query_as(&sql).bind(ids).fetch_all(db)).await?;
    Ok(rows.into_iter().collect())
}

/// `get_event_stats_for_school`'s counts: each upcoming event's clicks and
/// distinct Going users, in feed order. Like Python, a failed click count
/// reads as no clicks and a failed Going count as no Goings.
pub async fn event_stats(
    db: &PgPool,
    since: DateTime<Utc>,
    school_id: i64,
    cap: i64,
) -> Result<Vec<(i64, i64, i64)>, ApiError> {
    let ids = upcoming_ids(db, since, school_id, cap).await?;
    let clicks = counts(db, "get_event_click_counts", &ids)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Failed to fetch event click counts: {error}");
            HashMap::new()
        });
    let going = counts(db, "get_event_going_counts", &ids)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Failed to fetch event going counts: {error}");
            HashMap::new()
        });
    Ok(ids
        .into_iter()
        .map(|id| {
            let click_count = clicks.get(&id).copied().unwrap_or(0);
            let going_count = going.get(&id).copied().unwrap_or(0);
            (id, click_count, going_count)
        })
        .collect())
}

/// `admin_query.load_page_ids`'s filters on `admin_list_entries`, as SQL
/// conditions on the alias `entries`; values are bound from `$2` on.
pub fn admin_conditions(
    search: Option<&str>,
    school: Option<&str>,
    status: Option<&str>,
    category: Option<&str>,
) -> (String, Vec<String>) {
    let mut conditions = vec!["entries.resource = $1".to_owned()];
    let mut values = Vec::new();
    if let Some(search) = search.map(python_strip).filter(|search| !search.is_empty()) {
        // PostgREST's `ilike`: `*` is a wildcard too.
        values.push(format!("%{}%", search.replace('*', "%")));
        conditions.push(format!("entries.search_text ILIKE ${}", values.len() + 1));
    }
    for (column, value) in [
        ("school", school),
        ("status", status),
        ("category", category),
    ] {
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            values.push(value.to_owned());
            conditions.push(format!("entries.{column} = ${}", values.len() + 1));
        }
    }
    (conditions.join(" AND "), values)
}

/// The admin list's page CTEs over `admin_list_entries`: `entries` (all
/// matches) and `page_entries(id text, ord)` in `sort_at DESC, id` order.
pub fn admin_page_ctes(conditions: &str, offset_parameter: &str, limit_parameter: &str) -> String {
    format!(
        "entries AS MATERIALIZED (SELECT entries.id, entries.sort_at FROM public.admin_list_entries entries WHERE {conditions}), \
         page_entries AS (SELECT entries.id, row_number() OVER (ORDER BY entries.sort_at DESC, entries.id) AS ord \
         FROM entries ORDER BY entries.sort_at DESC, entries.id OFFSET {offset_parameter} LIMIT {limit_parameter})"
    )
}

/// `GET /events/admin`: one page of `admin_list_entries` events, hydrated, and the total.
pub async fn admin_page(
    db: &PgPool,
    resource: &str,
    pagination: crate::api::pagination::Pagination,
    search: Option<&str>,
    school: Option<&str>,
    status: Option<&str>,
    category: Option<&str>,
) -> Result<(Vec<Event>, i64), ApiError> {
    let (conditions, values) = admin_conditions(search, school, status, category);
    let offset = format!("${}", values.len() + 2);
    let limit = format!("${}", values.len() + 3);
    let sql = format!(
        "{} SELECT json_build_array((SELECT count(*) FROM entries), (SELECT events FROM events_json))",
        with_hydration(&format!(
            "{}, page AS (SELECT page_entries.id::int8 AS id, page_entries.ord FROM page_entries)",
            admin_page_ctes(&conditions, &offset, &limit)
        ))
    );
    let result: serde_json::Value = read_with_retry(|| {
        let mut query = sqlx::query_scalar(&sql).bind(resource);
        for value in &values {
            query = query.bind(value.as_str());
        }
        query
            .bind(pagination.offset())
            .bind(pagination.page_size)
            .fetch_one(db)
    })
    .await?;
    let [total, events]: [serde_json::Value; 2] = serde_json::from_value(result)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("admin JSON: {error}")))?;
    Ok((
        hydrate_json(db, events).await?,
        total.as_i64().unwrap_or_default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_host_matches_urlsplit() {
        for (url, host) in [
            ("https://www.scsu.ca/events/", "scsu.ca"),
            (
                "https://Cornell.CampusGroups.com/rsvp?id=1",
                "cornell.campusgroups.com",
            ),
            ("http://user:pw@events.wlu.ca:8080/x", "events.wlu.ca"),
            ("https://[::1]:80/x", "::1"),
            ("instagram.com/p/abc", ""),
            ("//cdn.example.com/a", "cdn.example.com"),
            ("", ""),
            ("  https://www.example.com", "example.com"),
        ] {
            assert_eq!(url_host(url), host, "{url}");
        }
    }

    #[test]
    fn today_starts_at_local_midnight() {
        let now = "2026-11-02T03:30:00Z".parse::<DateTime<Utc>>().unwrap();
        // 22:30 the day before in Toronto (EST, -5).
        assert_eq!(
            today_start_utc("America/Toronto", now).unwrap(),
            "2026-11-01T04:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        assert_eq!(
            today_start_utc("UTC", now).unwrap(),
            "2026-11-02T00:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        assert_eq!(
            today_start_utc("America/St_Johns", now).unwrap(),
            "2026-11-02T03:30:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        // Havana springs forward at midnight: 00:00 does not exist, and
        // zoneinfo's fold=0 reads it with the old offset (-5).
        let havana = "2026-03-08T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(
            today_start_utc("America/Havana", havana).unwrap(),
            "2026-03-08T05:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        assert!(today_start_utc("Not/AZone", now).is_err());
    }

    #[test]
    fn the_latest_added_event_has_not_ended() {
        // test_get_latest_added_event_skips_ended_events: an occurrence ending
        // now or later, or with no end and a start within the hour.
        let condition = "EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = e.id \
             AND (d.dtend_utc >= now() OR (d.dtend_utc IS NULL \
             AND d.dtstart_utc >= now() - make_interval(mins => 60))))";
        assert_eq!(not_ended_sql(), condition);
        for school in [Some("$1"), None] {
            assert!(latest_sql(school).contains(condition), "{school:?}");
        }
    }
}
