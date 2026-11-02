//! Queue browser engagement for the source posts on newly published carousels.
//!
//! The publishing tables are the selection ledger. Draft items never authorize
//! engagement, and only public account identity fields leave the database here.

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::browser_queue::BrowserJobQueue;
use super::browser_session::{canonical_post_url, validate_account_username};
use super::errors::BrowserError;
use super::ledger::{
    acknowledge_carousel_delivery, freeze_browser_sources, validate_browser_sources,
};
use crate::controlbox::instagram_browser as control;
use crate::db::BlockingPool;
use crate::schools::validate_recipient_id;

const ACTIVATION_SETTING: &str = "carousel_engagement_activated_at";
const SOURCE_REGISTRATION_SETTING: &str = "carousel_engagement_source_registered";

/// One enabled school's public browser identity, without credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngagementAccount {
    pub school: String,
    pub recipient_id: String,
    pub account_username: String,
}

/// An enabled publishing account with its school's routing.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct PublishingAccount {
    pub account_key: String,
    pub school_id: i32,
    pub instagram_user_id: String,
    pub instagram_username: String,
    pub slug: Option<String>,
    pub recipient_id: Option<String>,
}

/// A published carousel not yet delivered to this queue generation.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct PublishedBatch {
    pub id: Uuid,
    pub account_key: String,
    pub school_id: i32,
    pub instagram_user_id: Option<String>,
    pub published_at: DateTime<Utc>,
    /// `published_at` as PostgREST's JSON rendered it.
    pub published_at_text: String,
    pub browser_delivery_sources: Option<Value>,
}

/// One published carousel slide and its event's source post.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct PublishedItem {
    pub event_id: Option<i32>,
    pub source_url: Option<String>,
}

/// The publishing tables, through Postgres (or a test's stand-in).
pub trait PublishingStore {
    fn enabled_accounts(&self) -> Result<Vec<PublishingAccount>>;
    /// One keyset page of published batches between `since` and `until` that this
    /// queue generation has not acknowledged, after `after` (published_at, id).
    fn published_batches(
        &self,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
        delivery_generation: &str,
        after: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Vec<PublishedBatch>>;
    fn published_items(&self, batch_id: Uuid) -> Result<Vec<PublishedItem>>;
    /// `ensure_instagram_browser_source`: the cloud activation, the earliest proposed.
    fn ensure_source(&self, proposed: DateTime<Utc>) -> Result<Option<DateTime<Utc>>>;
    fn freeze_sources(&self, batch_id: &str, sources: &[Value]) -> Result<Vec<Value>>;
    fn acknowledge(&self, row_id: &str, delivery_generation: &str, sources: &[Value])
    -> Result<()>;
}

impl PublishingStore for BlockingPool {
    fn enabled_accounts(&self) -> Result<Vec<PublishingAccount>> {
        self.run(|pool| async move { enabled_accounts(&pool).await })
    }

    fn published_batches(
        &self,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
        delivery_generation: &str,
        after: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Vec<PublishedBatch>> {
        let generation = delivery_generation.to_owned();
        self.run(
            |pool| async move { published_batches(&pool, since, until, &generation, after).await },
        )
    }

    fn published_items(&self, batch_id: Uuid) -> Result<Vec<PublishedItem>> {
        self.run(|pool| async move { published_items(&pool, batch_id).await })
    }

    fn ensure_source(&self, proposed: DateTime<Utc>) -> Result<Option<DateTime<Utc>>> {
        self.run(|pool| async move {
            sqlx::query_scalar("SELECT public.ensure_instagram_browser_source($1)")
                .bind(proposed)
                .fetch_one(&pool)
                .await
        })
    }

    fn freeze_sources(&self, batch_id: &str, sources: &[Value]) -> Result<Vec<Value>> {
        let batch_id = batch_id.to_owned();
        let sources = sources.to_vec();
        self.run(|pool| async move { freeze_browser_sources(&pool, &batch_id, &sources).await })
    }

    fn acknowledge(
        &self,
        row_id: &str,
        delivery_generation: &str,
        sources: &[Value],
    ) -> Result<()> {
        let (row_id, generation, sources) = (
            row_id.to_owned(),
            delivery_generation.to_owned(),
            sources.to_vec(),
        );
        self.run(|pool| async move {
            acknowledge_carousel_delivery(&pool, &row_id, &generation, &sources).await
        })
    }
}

fn value_error(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<BrowserError>(),
        Some(BrowserError::Value(_))
    )
}

fn value(message: &str) -> anyhow::Error {
    BrowserError::Value(message.to_owned()).into()
}

/// Resolve one enabled school's public browser identity, without credentials.
pub fn get_engagement_account(db: &dyn PublishingStore, school: &str) -> Result<EngagementAccount> {
    let slug = school.trim().to_lowercase();
    for account in db.enabled_accounts()? {
        if account.slug.as_deref() == Some(slug.as_str()) {
            return account_identity(&account);
        }
    }
    Err(value("School has no enabled Instagram publishing account"))
}

/// Read published selections and submit their original posts to the queue.
///
/// Cloud activation survives local queue recreation without historical backfill. Only
/// batches not delivered to this queue generation cross the network. The
/// timestamp/id keyset belongs to one poll, so publication that finishes later with an
/// older timestamp remains eligible on the next poll. Frozen source selections survive
/// interrupted enqueue, acknowledgement retries, and queue recreation without
/// following later edits to their events.
pub fn sync_published_carousels(
    queue: &BrowserJobQueue,
    db: &dyn PublishingStore,
    now: Option<DateTime<Utc>>,
) -> Result<Value> {
    let until = now.unwrap_or_else(Utc::now);
    let since = source_activation(queue, db, until)?;
    let generation = queue.delivery_generation().to_owned();
    let mut stats = Stats::default();
    let mut accounts: Option<Vec<PublishingAccount>> = None;
    let mut after: Option<(DateTime<Utc>, Uuid)> = None;
    loop {
        let page = db.published_batches(since, until, &generation, after)?;
        for batch in &page {
            stats.batches += 1;
            let delivered = (|| -> Result<Option<Vec<Value>>> {
                let completion_setting = format!("carousel_engagement_batch:{}", batch.id);
                let completed = queue.get_setting(&completion_setting)?.is_some();
                if completed
                    && (batch.browser_delivery_sources.is_some()
                        || queue
                            .get_setting(&format!("carousel_engagement_sources:{}", batch.id))?
                            .is_some())
                {
                    let sources = delivery_sources(queue, db, batch, None, &mut stats)?;
                    stats.skipped += 1;
                    return Ok(Some(sources));
                }
                if accounts.is_none() {
                    accounts = Some(db.enabled_accounts()?);
                }
                let account = accounts
                    .as_ref()
                    .expect("accounts were just read")
                    .iter()
                    .find(|account| account.account_key == batch.account_key)
                    .cloned();
                let Some(sources) = enqueue_batch(queue, db, batch, account.as_ref(), &mut stats)?
                else {
                    return Ok(None);
                };
                queue.set_setting(
                    &completion_setting,
                    Value::from(batch.published_at_text.clone()),
                )?;
                Ok(Some(sources))
            })();
            let sources = match delivered {
                Ok(Some(sources)) => sources,
                Ok(None) => continue,
                Err(error) if value_error(&error) => {
                    // A missing or ambiguous original selection cannot authorize changed posts.
                    tracing::warn!(
                        "Carousel {} has no faithful browser source selection",
                        batch.id
                    );
                    stats.skipped += 1;
                    continue;
                }
                Err(error) => return Err(error),
            };
            db.acknowledge(&batch.id.to_string(), &generation, &sources)?;
        }
        if page.len() < control().source_page_size {
            break;
        }
        let last = page.last().expect("a full page has a last row");
        let next = Some((last.published_at, last.id));
        if next == after {
            anyhow::bail!("Published carousel pagination did not advance");
        }
        after = next;
    }
    Ok(json!({
        "batches": stats.batches,
        "posts": stats.posts,
        "submitted": stats.submitted,
        "skipped": stats.skipped,
    }))
}

#[derive(Default)]
struct Stats {
    batches: i64,
    posts: i64,
    submitted: i64,
    skipped: i64,
}

/// Python's `datetime.fromisoformat` then `_utc`: a stored timestamp in UTC, naive
/// values read as UTC.
pub fn parse_utc(value: &str) -> Result<DateTime<Utc>> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    if let Ok(parsed) = DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%:z") {
        return Ok(parsed.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(value, format) {
            return Ok(parsed.and_utc());
        }
    }
    Err(self::value(&format!("Invalid isoformat string: '{value}'")))
}

/// Python's `datetime.isoformat()` for a UTC time: microseconds only when non-zero.
pub fn python_isoformat(at: DateTime<Utc>) -> String {
    if at.timestamp_subsec_micros() == 0 {
        at.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
    } else {
        at.format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string()
    }
}

fn source_activation(
    queue: &BrowserJobQueue,
    db: &dyn PublishingStore,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>> {
    let activated_at = queue.get_setting(ACTIVATION_SETTING)?;
    let stored = |activated_at: &Value| parse_utc(&crate::python_json::str(activated_at));
    if queue
        .get_setting(SOURCE_REGISTRATION_SETTING)?
        .as_ref()
        .is_some_and(crate::python_json::truthy)
    {
        return stored(&activated_at.unwrap_or(Value::Null));
    }
    let proposed = match &activated_at {
        Some(activated_at) => stored(activated_at)?,
        None => now,
    };
    let activated_at = db.ensure_source(proposed)?;
    let activated_at =
        activated_at.context("Instagram browser source returned no activation timestamp")?;
    queue.set_setting(
        ACTIVATION_SETTING,
        Value::from(python_isoformat(activated_at)),
    )?;
    queue.set_setting(SOURCE_REGISTRATION_SETTING, Value::Bool(true))?;
    Ok(activated_at)
}

fn enqueue_batch(
    queue: &BrowserJobQueue,
    db: &dyn PublishingStore,
    batch: &PublishedBatch,
    account: Option<&PublishingAccount>,
    stats: &mut Stats,
) -> Result<Option<Vec<Value>>> {
    let Some(account) = account.filter(|account| matches_publishing_account(batch, account)) else {
        stats.skipped += 1;
        return Ok(None);
    };
    let identity = match account_identity(account) {
        Ok(identity) => identity,
        Err(error) if value_error(&error) => {
            stats.skipped += 1;
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let sources = delivery_sources(queue, db, batch, Some(&identity), stats)?;
    if queue
        .get_setting(&format!("carousel_engagement_batch:{}", batch.id))?
        .is_some()
    {
        stats.skipped += 1;
        return Ok(Some(sources));
    }
    for source in &sources {
        stats.posts += 1;
        let enqueued = queue.enqueue_engagement(
            &identity.school,
            &identity.recipient_id,
            &identity.account_username,
            source["post_url"].as_str().unwrap_or_default(),
            source["event_id"].as_i64(),
            false,
        );
        match enqueued {
            Ok(_) => stats.submitted += 1,
            // A publishing identity can be valid for Meta but unavailable to this
            // browser. Its batch must not block other schools.
            Err(BrowserError::Value(_)) => {
                stats.skipped += 1;
                return Ok(None);
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(Some(sources))
}

/// Freeze one selection before the first enqueue and reuse it for every replay.
fn delivery_sources(
    queue: &BrowserJobQueue,
    db: &dyn PublishingStore,
    batch: &PublishedBatch,
    identity: Option<&EngagementAccount>,
    stats: &mut Stats,
) -> Result<Vec<Value>> {
    let setting = format!("carousel_engagement_sources:{}", batch.id);
    let local = queue.get_setting(&setting)?;
    let sources = if let Some(saved) = &batch.browser_delivery_sources {
        validate_browser_sources(saved)?
    } else {
        let candidate = if let Some(local) = &local {
            validate_browser_sources(local)?
        } else if queue
            .get_setting(&format!("carousel_engagement_batch:{}", batch.id))?
            .is_some()
        {
            let Some(identity) = identity else {
                return Err(value("Original carousel account identity is unavailable"));
            };
            let batch_id = batch.id;
            let items = db.published_items(batch_id)?;
            let event_ids: Vec<Option<i32>> = items.iter().map(|item| item.event_id).collect();
            if event_ids.is_empty() || event_ids.iter().any(Option::is_none) {
                return Err(value("Original carousel event identity is unavailable"));
            }
            let event_ids: Vec<i64> = event_ids.into_iter().flatten().map(i64::from).collect();
            queue.recorded_engagement_sources(
                &identity.recipient_id,
                &identity.account_username,
                &event_ids,
            )?
        } else {
            let batch_id = batch.id;
            let mut candidate = Vec::new();
            for item in db.published_items(batch_id)? {
                let Ok(post_url) =
                    canonical_post_url(item.source_url.as_deref().unwrap_or_default())
                else {
                    stats.skipped += 1;
                    continue;
                };
                candidate.push(json!({"post_url": post_url, "event_id": item.event_id}));
            }
            candidate
        };
        db.freeze_sources(&batch.id.to_string(), &candidate)?
    };
    if let Some(local) = &local
        && sources != validate_browser_sources(local)?
    {
        return Err(value("Cloud and local carousel source selections disagree"));
    }
    queue.set_setting(&setting, Value::from(sources.clone()))?;
    Ok(sources)
}

fn account_identity(account: &PublishingAccount) -> Result<EngagementAccount> {
    let recipient_id = validate_recipient_id(account.recipient_id.as_deref().unwrap_or_default())
        .map_err(|error| value(&error))?;
    let slug = account.slug.clone().unwrap_or_default().trim().to_owned();
    let username =
        validate_account_username(&account.instagram_username).map_err(|error| value(&error))?;
    if slug.is_empty() {
        return Err(value(
            "Instagram publishing account has incomplete browser identity",
        ));
    }
    Ok(EngagementAccount {
        school: slug,
        recipient_id,
        account_username: username,
    })
}

async fn enabled_accounts(pool: &PgPool) -> Result<Vec<PublishingAccount>> {
    Ok(sqlx::query_as(
        "SELECT account.account_key, account.school_id, account.instagram_user_id, \
                account.instagram_username, school.slug, school.recipient_id \
         FROM public.instagram_publishing_accounts AS account \
         LEFT JOIN public.schools AS school ON school.id = account.school_id \
         WHERE account.enabled ORDER BY account.account_key",
    )
    .fetch_all(pool)
    .await?)
}

async fn published_batches(
    pool: &PgPool,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    delivery_generation: &str,
    after: Option<(DateTime<Utc>, Uuid)>,
) -> Result<Vec<PublishedBatch>> {
    let generation = Uuid::parse_str(delivery_generation)?;
    Ok(sqlx::query_as(
        "SELECT id, account_key, school_id, instagram_user_id, published_at, \
                to_json(published_at) #>> '{}' AS published_at_text, browser_delivery_sources \
         FROM public.instagram_publish_batches \
         WHERE status = 'published' AND published_at >= $1 AND published_at <= $2 \
           AND (browser_delivery_generation IS NULL OR browser_delivery_generation <> $3) \
           AND ($4::timestamptz IS NULL OR published_at > $4 OR (published_at = $4 AND id > $5)) \
         ORDER BY published_at, id LIMIT $6",
    )
    .bind(since)
    .bind(until)
    .bind(generation)
    .bind(after.map(|(published_at, _)| published_at))
    .bind(after.map(|(_, id)| id))
    .bind(control().source_page_size as i64)
    .fetch_all(pool)
    .await?)
}

async fn published_items(pool: &PgPool, batch_id: Uuid) -> Result<Vec<PublishedItem>> {
    Ok(sqlx::query_as(
        "SELECT item.event_id, event.source_url \
         FROM public.instagram_publish_items AS item \
         LEFT JOIN public.events AS event ON event.id = item.event_id \
         WHERE item.batch_id = $1 AND item.published_at IS NOT NULL \
         ORDER BY item.position, item.id",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?)
}

fn matches_publishing_account(batch: &PublishedBatch, account: &PublishingAccount) -> bool {
    batch.school_id == account.school_id
        && batch.instagram_user_id.as_deref() == Some(account.instagram_user_id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_round_trip_like_python() {
        let at = parse_utc("2026-10-09T01:20:00+00:00").unwrap();
        assert_eq!(python_isoformat(at), "2026-10-09T01:20:00+00:00");
        let at = parse_utc("2026-10-09T01:20:00.5-04:00").unwrap();
        assert_eq!(python_isoformat(at), "2026-10-09T05:20:00.500000+00:00");
        assert_eq!(
            python_isoformat(parse_utc("2026-10-09T01:20:00").unwrap()),
            "2026-10-09T01:20:00+00:00"
        );
        assert!(parse_utc("None").is_err());
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/carousel_engagement.rs"]
mod python_tests;
