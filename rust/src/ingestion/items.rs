//! Claiming and settling rows of `public.ingestion_items`.
//!
//! Instagram rows start at `fetch` and become `ready` once the logged-out
//! fetcher fills in the post. Directory and `dm` rows arrive `ready`. A ready
//! row ends `done` or `not_event` and is kept, so a URL is never queued twice;
//! deleted posts end `gone`, rows that keep failing `failed`.

use anyhow::Result;
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
    use super::shortcode;

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
}
