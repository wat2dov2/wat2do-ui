//! Side effects of the rows the ingestion agent changed (`services/ingestion/changes.py`).
//!
//! Database triggers record every event and position the agent's login touches
//! in `ingestion_changes`. Draining refreshes the affected school feeds; people
//! going to a changed event hear about it through `event_change_alerts`.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tokio::sync::Mutex;

use crate::constants::{MAX_EVENT_DESCRIPTION_LENGTH, MAX_POSITION_DESCRIPTION_LENGTH};
use crate::revalidation::revalidate_schools;

static DRAIN: Mutex<()> = Mutex::const_new(());

#[derive(sqlx::FromRow)]
struct Change {
    kind: String,
    record_id: i64,
    school_id: Option<i32>,
}

/// Settle every recorded change, whichever parallel agent made it.
///
/// A row whose poster is still a `pending:` placeholder belongs to an agent
/// that has not stored it yet; settling it now would refresh feeds with a broken
/// image. It waits for that agent's own drain, or for the startup drain
/// (`include_pending_posters`) when the agent was killed.
pub async fn drain(pool: &PgPool, include_pending_posters: bool) -> Result<()> {
    let _guard = DRAIN.lock().await;
    let pending_filter = if include_pending_posters {
        ""
    } else {
        " WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE change.kind = 'event' \
              AND e.id = change.record_id AND e.source_image_url LIKE 'pending:%') \
            AND NOT EXISTS (SELECT 1 FROM public.positions p WHERE change.kind = 'position' \
              AND p.id = change.record_id AND p.source_image_url LIKE 'pending:%')"
    };
    let changes: Vec<Change> = sqlx::query_as(&format!(
        "SELECT change.kind, change.record_id, change.school_id FROM public.ingestion_changes AS change{pending_filter}"
    ))
    .fetch_all(pool)
    .await?;
    if changes.is_empty() {
        return Ok(());
    }
    let mut school_ids: Vec<i32> = changes
        .iter()
        .filter_map(|change| change.school_id)
        .collect();
    school_ids.sort_unstable();
    school_ids.dedup();
    let schools: Vec<String> =
        sqlx::query_scalar("SELECT slug FROM public.schools WHERE id = ANY($1)")
            .bind(&school_ids)
            .fetch_all(pool)
            .await?;
    revalidate_schools(&schools, &["events", "clubs", "positions"]).await;
    for kind in ["event", "position"] {
        let ids: Vec<i64> = changes
            .iter()
            .filter(|c| c.kind == kind)
            .map(|c| c.record_id)
            .collect();
        if !ids.is_empty() {
            sqlx::query(
                "DELETE FROM public.ingestion_changes WHERE kind = $1 AND record_id = ANY($2)",
            )
            .bind(kind)
            .bind(&ids)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// Point listed events at the newer source the agent took their poster from: its link,
/// caption and post time replace the old post's, so the page links and reads like the
/// poster it shows.
pub async fn refresh_sources(
    pool: &PgPool,
    event_ids: &[i64],
    source_url: &str,
    caption: &str,
    posted_at: Option<DateTime<Utc>>,
) -> Result<()> {
    if event_ids.is_empty() {
        return Ok(());
    }
    let caption = (!caption.is_empty()).then_some(caption);
    sqlx::query(
        "UPDATE public.events SET \
           source_url = $2, \
           description = coalesce(left($3, $4), description), \
           source_posted_at = coalesce($5, source_posted_at) \
         WHERE id = ANY($1)",
    )
    .bind(event_ids)
    .bind(source_url)
    .bind(caption)
    .bind(MAX_EVENT_DESCRIPTION_LENGTH)
    .bind(posted_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Give rows the agent created from `source_url` the source's text and post time.
pub async fn stamp_new_rows(
    pool: &PgPool,
    source_url: &str,
    caption: &str,
    posted_at: Option<DateTime<Utc>>,
    since: DateTime<Utc>,
) -> Result<()> {
    let caption = (!caption.is_empty()).then_some(caption);
    if caption.is_some() || posted_at.is_some() {
        sqlx::query(
            "UPDATE public.events SET \
               description = coalesce(left($2, $3), description), \
               source_posted_at = coalesce($4, source_posted_at) \
             WHERE source_url = $1 AND added_at >= $5",
        )
        .bind(source_url)
        .bind(caption)
        .bind(MAX_EVENT_DESCRIPTION_LENGTH)
        .bind(posted_at)
        .bind(since)
        .execute(pool)
        .await?;
    }
    if let Some(caption) = caption {
        sqlx::query(
            "UPDATE public.positions SET description = left($2, $3) WHERE source_url = $1 AND added_at >= $4",
        )
        .bind(source_url)
        .bind(caption)
        .bind(MAX_POSITION_DESCRIPTION_LENGTH)
        .bind(since)
        .execute(pool)
        .await?;
    }
    Ok(())
}
