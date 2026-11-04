//! The notification ledger GitHub records, and carousel delivery receipts.
//!
//! Each recorded notification post joins the ingestion queue through a
//! database trigger; nothing on the Mac claims or settles ledger rows.

use anyhow::{Context, Result};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::browser_session::canonical_post_url;
use super::errors::BrowserError;

fn invalid(message: &str) -> anyhow::Error {
    BrowserError::Value(message.to_owned()).into()
}

/// Validate the immutable public source selection carried by a delivery receipt.
pub fn validate_browser_sources(value: &Value) -> Result<Vec<Value>> {
    let Value::Array(items) = value else {
        return Err(invalid("Carousel delivery sources must be a list"));
    };
    let mut sources = Vec::new();
    for source in items {
        let Value::Object(source) = source else {
            return Err(invalid("Carousel delivery source is invalid"));
        };
        let (Some(Value::String(post_url)), Some(event_id)) =
            (source.get("post_url"), source.get("event_id"))
        else {
            return Err(invalid("Carousel delivery source is invalid"));
        };
        let event_id_valid = match event_id {
            Value::Null => true,
            Value::Number(number) => number.as_u64().is_some_and(|id| id > 0),
            _ => false,
        };
        if source.len() != 2 || !event_id_valid {
            return Err(invalid("Carousel delivery source is invalid"));
        }
        let canonical = canonical_post_url(post_url)
            .map_err(|_| invalid("Carousel delivery post URL is invalid"))?;
        if &canonical != post_url {
            return Err(invalid("Carousel delivery post URL is not canonical"));
        }
        sources.push(json!({"post_url": canonical, "event_id": event_id}));
    }
    Ok(sources)
}

fn uuid(value: &str) -> Result<Uuid> {
    Uuid::parse_str(value).map_err(|_| invalid("badly formed hexadecimal UUID string"))
}

/// Adopt the database's immutable winner before any local engagement is queued.
pub async fn freeze_browser_sources(
    pool: &PgPool,
    batch_id: &str,
    sources: &[Value],
) -> Result<Vec<Value>> {
    let batch_id = uuid(batch_id)?;
    let sources = validate_browser_sources(&Value::from(sources.to_vec()))?;
    let frozen: Option<Value> =
        sqlx::query_scalar("SELECT public.freeze_instagram_browser_sources($1, $2)")
            .bind(batch_id)
            .bind(Value::from(sources))
            .fetch_one(pool)
            .await
            .context("Instagram browser sources could not be frozen")?;
    validate_browser_sources(&frozen.unwrap_or(Value::Null))
}

/// Record delivery only after the carousel's posts have committed to the local queue.
///
/// This receipt is independent of engagement completion. A recreated queue uses a new
/// generation and discovers the carousel again.
pub async fn acknowledge_carousel_delivery(
    pool: &PgPool,
    row_id: &str,
    delivery_generation: &str,
    sources: &[Value],
) -> Result<()> {
    let generation = uuid(delivery_generation)?;
    let sources = validate_browser_sources(&Value::from(sources.to_vec()))?;
    let row_id = uuid(row_id)?;
    sqlx::query(
        "UPDATE public.instagram_publish_batches \
         SET browser_delivery_generation = $1, browser_delivery_sources = $2 \
         WHERE id = $3 AND status = 'published'",
    )
    .bind(generation)
    .bind(Value::from(sources))
    .bind(row_id)
    .execute(pool)
    .await
    .context("Carousel delivery could not be acknowledged")?;
    Ok(())
}

/// One exact Instagram media target recovered from a notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializedMedia {
    pub media_id: String,
    pub source_url: String,
}

/// What one notification records in the ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationRecord {
    pub school_id: i32,
    pub intended_recipient_id: String,
    pub push_id: String,
    pub push_category: String,
    pub cache_ent_id: Option<String>,
    pub total_non_mmc_media_count: Option<i64>,
    pub media: Vec<MaterializedMedia>,
}

impl NotificationRecord {
    /// The `record_instagram_notification_media` arguments, as Python sent them.
    pub fn arguments(&self) -> Result<Value> {
        let media: Vec<Value> = deduplicate_media(&self.media)?
            .into_iter()
            .map(|item| json!({"media_id": item.media_id, "source_url": item.source_url}))
            .collect();
        Ok(json!({
            "p_school_id": self.school_id,
            "p_intended_recipient_id": self.intended_recipient_id.trim(),
            "p_push_id": self.push_id.trim(),
            "p_push_category": self.push_category.trim(),
            "p_cache_ent_id": optional_text(self.cache_ent_id.as_deref()),
            "p_total_non_mmc_media_count": self.total_non_mmc_media_count,
            "p_media": media,
        }))
    }
}

/// Record one notification and its recovered media without claiming work; the
/// ledger row's ID and how many of its posts were new.
pub async fn record_notification_media(
    pool: &PgPool,
    record: &NotificationRecord,
) -> Result<(String, i64)> {
    let arguments = record.arguments()?;
    let count = record
        .total_non_mmc_media_count
        .map(i32::try_from)
        .transpose()
        .context("Instagram notification media count is out of range")?;
    let row: Option<(Option<Uuid>, Option<i32>)> = sqlx::query_as(
        "SELECT notification_id, newly_inserted_count \
         FROM public.record_instagram_notification_media($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(record.school_id)
    .bind(arguments["p_intended_recipient_id"].as_str())
    .bind(arguments["p_push_id"].as_str())
    .bind(arguments["p_push_category"].as_str())
    .bind(arguments["p_cache_ent_id"].as_str())
    .bind(count)
    .bind(&arguments["p_media"])
    .fetch_optional(pool)
    .await
    .context("Instagram notification ledger recording failed")?;
    let Some((Some(notification_id), newly_inserted_count)) = row else {
        anyhow::bail!("Instagram notification ledger returned no record ID");
    };
    Ok((
        notification_id.to_string(),
        i64::from(newly_inserted_count.unwrap_or(0)),
    ))
}

fn deduplicate_media(media: &[MaterializedMedia]) -> Result<Vec<MaterializedMedia>> {
    let mut deduplicated: Vec<MaterializedMedia> = Vec::new();
    for item in media {
        let normalized = MaterializedMedia {
            media_id: item.media_id.trim().to_owned(),
            source_url: item.source_url.trim().to_owned(),
        };
        match deduplicated
            .iter()
            .find(|existing| existing.media_id == normalized.media_id)
        {
            Some(existing) if existing.source_url != normalized.source_url => {
                return Err(invalid("A media ID cannot resolve to multiple source URLs"));
            }
            Some(_) => {}
            None => deduplicated.push(normalized),
        }
    }
    Ok(deduplicated)
}

fn optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_must_be_canonical_public_posts() {
        let valid = json!([{"post_url": "https://www.instagram.com/p/abc/", "event_id": 4}, {"post_url": "https://www.instagram.com/reel/x/", "event_id": null}]);
        assert_eq!(validate_browser_sources(&valid).unwrap().len(), 2);
        for invalid in [
            json!({}),
            json!([{"post_url": "https://www.instagram.com/p/abc/"}]),
            json!([{"post_url": "https://www.instagram.com/p/abc/", "event_id": 0}]),
            json!([{"post_url": "https://www.instagram.com/p/abc/", "event_id": true}]),
            json!([{"post_url": "https://instagram.com/p/abc", "event_id": 1}]),
            json!([{"post_url": "https://www.instagram.com/p/abc/", "event_id": 1, "x": 1}]),
        ] {
            assert!(validate_browser_sources(&invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn records_send_trimmed_unique_media() {
        let record = NotificationRecord {
            school_id: 7,
            intended_recipient_id: " 123 ".into(),
            push_id: "push".into(),
            push_category: "post".into(),
            cache_ent_id: Some("  ".into()),
            total_non_mmc_media_count: None,
            media: vec![
                MaterializedMedia {
                    media_id: "1".into(),
                    source_url: "https://www.instagram.com/p/B/".into(),
                },
                MaterializedMedia {
                    media_id: " 1".into(),
                    source_url: "https://www.instagram.com/p/B/ ".into(),
                },
            ],
        };
        let arguments = record.arguments().unwrap();
        assert_eq!(arguments["p_intended_recipient_id"], "123");
        assert_eq!(arguments["p_cache_ent_id"], Value::Null);
        assert_eq!(arguments["p_media"].as_array().unwrap().len(), 1);
        let conflicting = NotificationRecord {
            media: vec![
                MaterializedMedia {
                    media_id: "1".into(),
                    source_url: "https://www.instagram.com/p/B/".into(),
                },
                MaterializedMedia {
                    media_id: "1".into(),
                    source_url: "https://www.instagram.com/p/C/".into(),
                },
            ],
            ..record
        };
        assert!(conflicting.arguments().is_err());
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/ledger.rs"]
mod python_tests;
