//! Posting a claimed carousel (`service.py`): the morning publish posts every
//! school's ready draft for today, and the admin's Publish button posts one
//! batch the API claimed.
//!
//! The slides are drawn from the events' live data at this moment, uploaded,
//! and handed to Meta as one carousel. Once posted, the batch keeps the
//! images it posted; the emulator worker then adds its song. Any failure is
//! recorded on the batch, which an admin can publish again.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Result, anyhow};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::meta::{GRAPH_HOST, MetaClient};
use super::rendering::Renderer;
use super::{Refused, error_message, isoformat, job_error};
use crate::api::events::model::Event;
use crate::api::events::store;
use crate::api::routes::instagram_publishing::batches::{
    self, Batch, KIND_EVENTS, STATUS_FAILED, STATUS_PUBLISHED, STATUS_PUBLISHING,
    STATUS_READY_FOR_REVIEW,
};
use crate::api::routes::instagram_publishing::credentials::load_account_credentials;
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::settings::Settings;
use crate::storage::Storage;

/// The emulator worker adds a song to a carousel whose link it knows.
const MUSIC_PENDING: &str = "pending";
const MUSIC_FAILED: &str = "failed";

/// Where carousels go: the Graph API (a stand-in in tests) and the renderer.
pub struct Publisher<'a> {
    db: &'a PgPool,
    encryption_key: String,
    graph_host: String,
    poll_interval: Option<Duration>,
    renderer: Renderer<'a>,
}

impl<'a> Publisher<'a> {
    pub fn new(db: &'a PgPool, settings: &Settings, storage: &'a Storage) -> Self {
        Self {
            db,
            encryption_key: settings.instagram_token_encryption_key.clone(),
            graph_host: GRAPH_HOST.to_owned(),
            poll_interval: None,
            renderer: Renderer::new(settings, storage),
        }
    }

    /// Post to a Graph API stand-in, polling it without waiting.
    #[cfg(test)]
    pub fn with_graph(mut self, host: &str) -> Self {
        self.graph_host = host.to_owned();
        self.poll_interval = Some(Duration::ZERO);
        self
    }

    fn graph(&self, access_token: &str) -> Result<MetaClient> {
        let client = MetaClient::with_host(&self.graph_host, access_token)?;
        Ok(match self.poll_interval {
            Some(interval) => client.poll_interval(interval),
            None => client,
        })
    }

    /// `publish_batch`: post a batch the admin's Publish button claimed and
    /// return its status after. A batch that is not `publishing` is left alone.
    pub async fn publish_batch(&self, batch_id: Uuid) -> Result<String> {
        let batch = batches::get_batch(self.db, batch_id)
            .await
            .map_err(job_error)?;
        if batch.row.status != STATUS_PUBLISHING {
            tracing::warn!(
                "Instagram batch {batch_id} is {}, not publishing",
                batch.row.status
            );
            return Ok(batch.row.status);
        }
        self.publish_claimed(batch).await?;
        Ok(batches::get_batch(self.db, batch_id)
            .await
            .map_err(job_error)?
            .row
            .status)
    }

    /// `publish_ready_drafts`: post every school's ready events draft for
    /// today, one school at a time. A draft with too few slides stays in
    /// review; one an admin changed meanwhile is skipped.
    pub async fn publish_ready_drafts(&self, now: DateTime<Utc>) -> Result<BTreeMap<String, i64>> {
        let rows: Vec<(Uuid, String, i32, i64)> = sqlx::query_as(
            "SELECT b.id, b.account_key, b.version, \
                 (SELECT count(*) FROM public.instagram_publish_items i WHERE i.batch_id = b.id) \
             FROM public.instagram_publish_batches b \
             WHERE b.batch_kind = $1 AND b.local_date = $2 AND b.status = $3 \
             ORDER BY b.account_key",
        )
        .bind(KIND_EVENTS)
        .bind(super::drafts::local_date(now))
        .bind(STATUS_READY_FOR_REVIEW)
        .fetch_all(self.db)
        .await?;
        let mut outcomes: BTreeMap<String, i64> = BTreeMap::new();
        for (batch_id, account_key, version, slides) in rows {
            if slides < INSTAGRAM_PUBLISHING.minimum_event_slides as i64 {
                *outcomes.entry("too_few_events".into()).or_default() += 1;
                continue;
            }
            let claimed =
                batches::claim_batch(self.db, &self.encryption_key, batch_id, i64::from(version))
                    .await;
            let batch = match claimed {
                Ok(batch) => batch,
                Err(error) => {
                    tracing::error!(
                        "Instagram draft {account_key} could not be claimed: {:#}",
                        job_error(error)
                    );
                    *outcomes.entry("skipped".into()).or_default() += 1;
                    continue;
                }
            };
            self.publish_claimed(batch).await?;
            let status = batches::get_batch(self.db, batch_id)
                .await
                .map_err(job_error)?
                .row
                .status;
            *outcomes.entry(status).or_default() += 1;
        }
        Ok(outcomes)
    }

    /// `publish_claimed_batch`: post a claimed batch; any failure marks it
    /// failed with the reason.
    async fn publish_claimed(&self, batch: Batch) -> Result<()> {
        let batch_id = batch.row.id;
        if let Err(error) = self.try_publish(&batch).await {
            tracing::error!("Instagram batch {batch_id} failed to publish: {error:#}");
            sqlx::query(
                "UPDATE public.instagram_publish_batches \
                 SET status = $2, error_message = $3, updated_at = $4 WHERE id = $1",
            )
            .bind(batch_id)
            .bind(STATUS_FAILED)
            .bind(error_message(&error))
            .bind(Utc::now())
            .execute(self.db)
            .await?;
        }
        Ok(())
    }

    async fn try_publish(&self, batch: &Batch) -> Result<()> {
        let credentials = load_account_credentials(
            self.db,
            &self.encryption_key,
            &batch.row.account_key,
            Utc::now(),
        )
        .await
        .map_err(job_error)?;
        if batch.row.instagram_user_id.as_deref() != Some(credentials.instagram_user_id.as_str()) {
            return Err(
                Refused("Instagram account credentials no longer match this batch".into()).into(),
            );
        }
        // The claim locks out edits; history keeps exactly the slides posted.
        let selected: Vec<i32> = batch
            .items
            .iter()
            .filter_map(|item| item.row.event_id)
            .collect();
        sqlx::query(
            "DELETE FROM public.instagram_publish_items WHERE batch_id = $1 \
             AND published_at IS NULL AND (event_id IS NULL OR NOT event_id = ANY($2))",
        )
        .bind(batch.row.id)
        .bind(&selected)
        .execute(self.db)
        .await?;
        let result = self.post(&credentials.access_token, batch).await;
        // The feeds show which events were posted, whatever happened after.
        let mut schools = vec![batch.row.school.clone()];
        schools.extend(
            batch
                .items
                .iter()
                .filter_map(|item| item.event.as_ref()?.school.clone()),
        );
        if result.is_ok() || result.as_ref().is_err_and(|(posted, _)| *posted) {
            crate::revalidation::revalidate_schools(&schools, &["events"]).await;
        }
        result.map_err(|(_, error)| error)
    }

    /// `_publish_claimed_batch`: draw the slides, post the carousel and keep
    /// what was posted. The error says whether Instagram already has the post.
    async fn post(&self, access_token: &str, batch: &Batch) -> Result<(), (bool, anyhow::Error)> {
        let before = |error: anyhow::Error| (false, error);
        let client = self.graph(access_token).map_err(before)?;
        let row = &batch.row;
        let user_id = row.instagram_user_id.as_deref().unwrap_or_default();
        let mut items: Vec<&batches::Item> = batch.items.iter().collect();
        items.sort_by_key(|item| item.row.position);
        let mut events = Vec::new();
        for item in &items {
            let event = item
                .event
                .as_ref()
                .ok_or_else(|| before(anyhow!("slide {} has no event", item.row.id)))?;
            let mut payload = slide_payload(self.db, event).await.map_err(before)?;
            if let Some(labels) = batch.sticker_selections.get(&event.id.to_string()) {
                let labels: Vec<&String> = labels
                    .iter()
                    .take(INSTAGRAM_PUBLISHING.maximum_stickers_per_event)
                    .collect();
                payload.insert("sticker_labels".into(), serde_json::json!(labels));
            }
            events.push(Value::Object(payload));
        }
        let events_rendered = async {
            let cover_url = self
                .renderer
                .cover(
                    &events,
                    &row.school,
                    &row.cover_body,
                    &row.local_date.to_string(),
                    batch.new_event_count,
                    &row.batch_kind,
                )
                .await?;
            let cover = client.create_image_container(user_id, &cover_url).await?;
            client.wait_until_ready(&cover).await?;
            let mut child_ids = vec![cover];
            let mut asset_urls: Vec<(i64, String)> = Vec::new();
            for event in &events {
                let asset_url = self.renderer.event(event).await?;
                let child = client.create_image_container(user_id, &asset_url).await?;
                client.wait_until_ready(&child).await?;
                child_ids.push(child);
                asset_urls.push((event["id"].as_i64().unwrap_or_default(), asset_url));
            }
            let mut others = Vec::new();
            for event in &batch.other_events {
                others.push(Value::Object(slide_payload(self.db, event).await?));
            }
            let outro_url = self
                .renderer
                .outro(&others, &row.school, &row.batch_kind)
                .await?;
            let outro = client.create_image_container(user_id, &outro_url).await?;
            client.wait_until_ready(&outro).await?;
            child_ids.push(outro);
            let carousel = client
                .create_carousel_container(user_id, &child_ids, &row.caption)
                .await?;
            client.wait_until_ready(&carousel).await?;
            let media_id = client.publish(user_id, &carousel).await?;
            anyhow::Ok((cover_url, outro_url, asset_urls, media_id))
        };
        let (cover_url, outro_url, asset_urls, media_id) = events_rendered.await.map_err(before)?;
        let published_at = Utc::now();
        let permalink = match client.get_permalink(&media_id).await {
            Ok(permalink) => Some(permalink),
            Err(_) => {
                // Already posted: a missing link only means no song is added.
                tracing::warn!("Instagram did not return the permalink for media {media_id}");
                None
            }
        };
        self.record_published(
            batch,
            &items,
            PostedCarousel {
                media_id,
                permalink,
                cover_url,
                outro_url,
                asset_urls,
                published_at,
            },
        )
        .await
        .map_err(|error| (true, error))
    }

    /// The slides are history now: the batch keeps the images it posted
    /// while the events behind them move on.
    async fn record_published(
        &self,
        batch: &Batch,
        items: &[&batches::Item],
        posted: PostedCarousel,
    ) -> Result<()> {
        for item in items {
            let asset_url = item.row.event_id.and_then(|id| {
                posted
                    .asset_urls
                    .iter()
                    .find(|(event_id, _)| *event_id == i64::from(id))
                    .map(|(_, url)| url.clone())
            });
            sqlx::query(
                "UPDATE public.instagram_publish_items \
                 SET published_at = $2, published_asset_url = $3, updated_at = $2 WHERE id = $1",
            )
            .bind(item.row.id)
            .bind(posted.published_at)
            .bind(asset_url)
            .execute(self.db)
            .await?;
        }
        let (music_status, music_error) = match posted.permalink {
            Some(_) => (MUSIC_PENDING, None),
            None => (
                MUSIC_FAILED,
                Some("Instagram did not return the post's link"),
            ),
        };
        sqlx::query(
            "UPDATE public.instagram_publish_batches SET status = $2, meta_media_id = $3, \
             permalink = $4, music_status = $5, music_error = $6, published_cover_url = $7, \
             published_outro_url = $8, published_at = $9, updated_at = $9, error_message = NULL \
             WHERE id = $1",
        )
        .bind(batch.row.id)
        .bind(STATUS_PUBLISHED)
        .bind(&posted.media_id)
        .bind(&posted.permalink)
        .bind(music_status)
        .bind(music_error)
        .bind(&posted.cover_url)
        .bind(&posted.outro_url)
        .bind(posted.published_at)
        .execute(self.db)
        .await?;
        Ok(())
    }
}

/// What Instagram now shows for a batch.
struct PostedCarousel {
    media_id: String,
    permalink: Option<String>,
    cover_url: String,
    outro_url: String,
    asset_urls: Vec<(i64, String)>,
    published_at: DateTime<Utc>,
}

/// `_slide_payload`: the event as the renderer reads it, flattened onto its
/// first occurrence, with the school's zone (slides print local times).
pub async fn slide_payload(db: &PgPool, event: &Event) -> Result<serde_json::Map<String, Value>> {
    let occurrence = event
        .occurrences
        .first()
        .ok_or_else(|| anyhow!("event {} has no date", event.id))?;
    let Value::Object(mut payload) = serde_json::to_value(event.summary())? else {
        return Err(anyhow!("an event summary is an object"));
    };
    payload.shift_remove("occurrences");
    payload.insert(
        "dtstart_utc".into(),
        isoformat(&occurrence.dtstart_utc).into(),
    );
    payload.insert(
        "dtend_utc".into(),
        occurrence
            .dtend_utc
            .as_ref()
            .map_or(Value::Null, |end| isoformat(end).into()),
    );
    let tz = store::school_timezone(db, event.school.as_deref())
        .await
        .map_err(job_error)?;
    payload.insert("tz".into(), tz.into());
    Ok(payload)
}
