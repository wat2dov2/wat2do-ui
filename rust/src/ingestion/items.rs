//! Claiming and settling rows of `public.ingestion_items`.
//!
//! Instagram rows start at `fetch` and become `ready` once the logged-out
//! fetcher fills in the post. Directory and `dm` rows arrive `ready`. A ready
//! row ends `done` or `not_event` and is kept, so a URL is never queued twice;
//! deleted posts end `gone`, rows that keep failing `failed`.
//! `enqueue` and `status` (`services/ingestion/items.py`) add posts by hand and
//! count the rows.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use sqlx::PgPool;

use crate::controlbox::INGESTION;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Fetch,
    Ready,
}

impl Stage {
    fn as_str(self) -> &'static str {
        match self {
            Stage::Fetch => "fetch",
            Stage::Ready => "ready",
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Item {
    pub source_url: String,
    pub school: String,
    pub source: String,
    pub post: Option<serde_json::Value>,
    pub directory_source_id: Option<i64>,
    pub attempts: i16,
    /// A club asked us in our DMs to feature this post in a carousel.
    pub carousel_requested: bool,
}

/// Lease the oldest row waiting at `stage`; two claimers never get the same row.
pub async fn claim(pool: &PgPool, stage: Stage) -> Result<Option<Item>> {
    Ok(sqlx::query_as(
        "SELECT item.source_url, coalesce(school.slug, '') AS school, item.source, item.post, \
                item.directory_source_id, item.attempts, \
                item.carousel_requested_at IS NOT NULL AS carousel_requested \
         FROM public.claim_ingestion_item($1, $2) AS item \
         LEFT JOIN public.schools AS school ON school.id = item.school_id",
    )
    .bind(stage.as_str())
    .bind(INGESTION.claim_lease_seconds)
    .fetch_optional(pool)
    .await?)
}

pub async fn mark_fetched(pool: &PgPool, item: &Item, post: &serde_json::Value) -> Result<()> {
    sqlx::query(
        "UPDATE public.ingestion_items SET status = 'ready', post = $2, attempts = 0, \
         claimed_until = NULL, updated_at = now() WHERE source_url = $1",
    )
    .bind(&item.source_url)
    .bind(post)
    .execute(pool)
    .await?;
    Ok(())
}

/// Settle a row as `done`, `not_event` or `gone`.
pub async fn mark(pool: &PgPool, item: &Item, status: &str) -> Result<()> {
    sqlx::query(
        "UPDATE public.ingestion_items SET status = $2, claimed_until = NULL, updated_at = now() \
         WHERE source_url = $1",
    )
    .bind(&item.source_url)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

/// Put a row back to wait; one that keeps failing is given up as `failed`.
pub async fn release(
    pool: &PgPool,
    item: &Item,
    stage: Stage,
    delay_seconds: Option<u64>,
) -> Result<()> {
    if i32::from(item.attempts) >= INGESTION.max_attempts {
        return mark(pool, item, "failed").await;
    }
    let delay = delay_seconds.unwrap_or(INGESTION.retry_backoff_seconds) as f64;
    sqlx::query(
        "UPDATE public.ingestion_items SET status = $2, \
         claimed_until = now() + make_interval(secs => $3), updated_at = now() WHERE source_url = $1",
    )
    .bind(&item.source_url)
    .bind(stage.as_str())
    .bind(delay)
    .execute(pool)
    .await?;
    Ok(())
}

const STATUSES: [&str; 7] = [
    "fetch",
    "ready",
    "working",
    "done",
    "not_event",
    "gone",
    "failed",
];

/// One queue key per post, whether it was shared as a post, reel or video.
pub fn post_key(url: &str) -> Result<String> {
    let code = shortcode(url).context("Not an Instagram post URL")?;
    Ok(format!("https://www.instagram.com/p/{code}/"))
}

/// Add Instagram posts to fetch; a post already in the queue keeps its row.
/// Returns how many were added.
pub async fn queue_instagram(pool: &PgPool, urls: &[String], school: &str) -> Result<usize> {
    let school_id = school_id(pool, school).await?;
    let mut keys: Vec<String> = Vec::new();
    for url in urls {
        let key = post_key(url)?;
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    if keys.is_empty() {
        return Ok(0);
    }
    let added: Vec<String> = sqlx::query_scalar(
        "INSERT INTO public.ingestion_items (source_url, school_id, source) \
         SELECT key, $2, 'instagram' FROM unnest($1::text[]) WITH ORDINALITY AS keys(key, position) \
         ORDER BY position ON CONFLICT (source_url) DO NOTHING RETURNING source_url::text",
    )
    .bind(&keys)
    .bind(school_id)
    .fetch_all(pool)
    .await?;
    Ok(added.len())
}

/// A school by slug, or else by name, like `school_service.get_school_id`.
async fn school_id(pool: &PgPool, school: &str) -> Result<i32> {
    if let Some(found) = crate::schools::by_slug(pool, school).await? {
        return Ok(found.id);
    }
    let name = school.trim();
    let by_name: Option<i32> = if name.is_empty() {
        None
    } else {
        sqlx::query_scalar("SELECT id FROM public.schools WHERE name ILIKE $1 LIMIT 1")
            .bind(name)
            .fetch_optional(pool)
            .await?
    };
    by_name.context("School is not registered")
}

/// How many rows wait at, or ended in, each status.
pub async fn counts(pool: &PgPool) -> Result<BTreeMap<&'static str, i64>> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, count(*) FROM public.ingestion_items GROUP BY status")
            .fetch_all(pool)
            .await?;
    Ok(STATUSES
        .into_iter()
        .map(|status| {
            let count = rows
                .iter()
                .find(|(found, _)| found == status)
                .map_or(0, |(_, count)| *count);
            (status, count)
        })
        .collect())
}

/// The post's shortcode from a queue key such as `https://www.instagram.com/p/<code>/`.
pub fn shortcode(url: &str) -> Option<&str> {
    let path = url.trim().strip_prefix("https://")?;
    let path = path
        .strip_prefix("www.")
        .unwrap_or(path)
        .strip_prefix("instagram.com/")?;
    let (kind, rest) = path.split_once('/')?;
    if !matches!(kind, "p" | "reel" | "tv") {
        return None;
    }
    let code = rest.strip_suffix('/').unwrap_or(rest);
    (!code.is_empty()
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
    .then_some(code)
}

#[cfg(test)]
mod tests {
    use super::{post_key, shortcode};

    #[test]
    fn shortcodes_come_only_from_post_urls() {
        assert_eq!(
            shortcode("https://www.instagram.com/p/De5IrfsBdO-/"),
            Some("De5IrfsBdO-")
        );
        assert_eq!(shortcode("https://instagram.com/reel/abc_1"), Some("abc_1"));
        assert_eq!(shortcode("https://www.instagram.com/stories/abc/"), None);
        assert_eq!(shortcode("https://wat2do.io/dm/uwaterloo/abc"), None);
    }

    #[test]
    fn every_form_of_a_post_url_is_one_key() {
        for url in [
            "https://www.instagram.com/p/ABC123/",
            "https://instagram.com/p/ABC123",
            "https://www.instagram.com/reel/ABC123/",
            "https://www.instagram.com/tv/ABC123/",
            "  https://www.instagram.com/p/ABC123/  ",
        ] {
            assert_eq!(
                post_key(url).unwrap(),
                "https://www.instagram.com/p/ABC123/",
                "{url}"
            );
        }
    }

    #[test]
    fn only_post_urls_have_a_key() {
        for url in [
            "https://www.instagram.com/clubname/",
            "https://www.instagram.com/stories/club/123/",
            "https://example.com/p/ABC123/",
            "http://www.instagram.com/p/ABC123/",
            "https://www.instagram.com/p/ABC123//",
            "https://www.instagram.com/p/ABC123/?img_index=1",
        ] {
            assert_eq!(
                post_key(url).unwrap_err().to_string(),
                "Not an Instagram post URL",
                "{url}"
            );
        }
    }
}
