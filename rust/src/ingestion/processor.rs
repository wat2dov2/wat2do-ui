//! The always-on ingestion processor (`services/ingestion/processor.py`).
//!
//! `fetch_lanes` tasks fill in notified Instagram posts with the logged-out
//! fetcher; `parallel_agents` tasks each run one Haiku agent on the next ready
//! row; one more lane reads, logged out, the Instagram profile of each club that
//! still needs a logo or a real name. Supabase Realtime wakes them as soon as a
//! row is added or changes; with nothing waiting they sleep.

use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::Result;
use fs2::FileExt;
use serde_json::Value;
use sqlx::PgPool;
use tokio::sync::{Mutex, Notify};
use tokio::time::Instant;

use super::club_logos::{ClubLogos, is_blocked};
use super::fetch::{FetchBlocked, fetch_post};
use super::items::{self, Item, Stage};
use super::stop::Stop;
use super::{agent, changes, realtime, state_directory};
use crate::claude::remove_leftovers;
use crate::controlbox::INGESTION;

/// Counts wake-ups so a task never sleeps through one that arrived meanwhile.
#[derive(Default)]
struct Wake {
    generation: AtomicU64,
    notify: Notify,
}

impl Wake {
    fn notify(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    fn seen(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    async fn wait(&self, seen: u64, timeout: Duration) {
        let notified = self.notify.notified();
        if self.seen() != seen {
            return;
        }
        let _ = tokio::time::timeout(timeout, notified).await;
    }
}

#[derive(Clone, Copy)]
enum Lane {
    Fetch,
    Process,
    ClubLogos,
}

struct Processor {
    pool: PgPool,
    stopping: Stop,
    wake: Wake,
    stats: Mutex<BTreeMap<&'static str, u64>>,
    club_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    publishers: Mutex<Option<HashMap<i64, Option<String>>>>,
    fetch_paused_until: Mutex<Option<Instant>>,
    club_logos: Mutex<ClubLogos>,
}

impl Processor {
    async fn count(&self, outcome: &'static str) {
        *self.stats.lock().await.entry(outcome).or_default() += 1;
    }

    async fn step(&self, lane: Lane) -> Result<bool> {
        match lane {
            Lane::Fetch => self.fetch_next().await,
            Lane::Process => self.process_next().await,
            Lane::ClubLogos => self.fill_club_logo_next().await,
        }
    }

    /// Repeat the lane's step until it finds nothing; then sleep until woken, or stop.
    async fn work(&self, lane: Lane, wait_for_work: bool) {
        while !self.stopping.is_set() {
            let seen = self.wake.seen();
            match self.step(lane).await {
                Ok(true) => continue,
                Ok(false) => {}
                Err(error) => {
                    // Supabase or network trouble: wait, then carry on with the next row.
                    tracing::warn!("Ingestion queue unavailable ({error:#})");
                    self.stopping
                        .sleep(Duration::from_secs_f64(
                            INGESTION.realtime_reconnect_seconds,
                        ))
                        .await;
                    continue;
                }
            }
            if !wait_for_work {
                return;
            }
            // Released rows become claimable again once their retry time passes.
            tokio::select! {
                _ = self.wake.wait(seen, Duration::from_secs(INGESTION.retry_backoff_seconds)) => {}
                _ = self.stopping.stopped() => {}
            }
        }
    }

    async fn fetch_next(&self) -> Result<bool> {
        if self.fetch_paused().await {
            return Ok(false);
        }
        let Some(item) = items::claim(&self.pool, Stage::Fetch).await? else {
            return Ok(false);
        };
        let Some(shortcode) = items::shortcode(&item.source_url) else {
            items::mark(&self.pool, &item, "gone").await?;
            self.count("gone").await;
            return Ok(true);
        };
        match fetch_post(shortcode).await {
            Err(blocked) => {
                self.pause_fetches(&blocked).await;
                items::release(
                    &self.pool,
                    &item,
                    Stage::Fetch,
                    Some(INGESTION.fetch_block_pause_seconds),
                )
                .await?;
                Ok(false)
            }
            Ok(None) => {
                // An empty page is usually a deleted post; look once more before giving up.
                if item.attempts >= 2 {
                    items::mark(&self.pool, &item, "gone").await?;
                    self.count("gone").await;
                } else {
                    items::release(&self.pool, &item, Stage::Fetch, None).await?;
                }
                Ok(true)
            }
            Ok(Some(post)) => {
                items::mark_fetched(&self.pool, &item, &post).await?;
                self.count("fetched").await;
                self.wake.notify();
                Ok(true)
            }
        }
    }

    async fn fill_club_logo_next(&self) -> Result<bool> {
        if self.fetch_paused().await {
            return Ok(false);
        }
        match self.club_logos.lock().await.fill_next(&self.pool).await {
            Ok(false) => return Ok(false),
            Ok(true) => {}
            Err(error) => {
                if let Some(blocked) = is_blocked(&error) {
                    self.pause_fetches(blocked).await;
                    return Ok(false);
                }
                return Err(error);
            }
        }
        self.count("club_logo_read").await;
        // Club logos are background work: space the reads out behind the post fetches.
        self.stopping
            .sleep(Duration::from_secs_f64(
                INGESTION.club_logo_read_delay_seconds,
            ))
            .await;
        Ok(true)
    }

    async fn fetch_paused(&self) -> bool {
        let until = *self.fetch_paused_until.lock().await;
        let Some(remaining) = until.and_then(|until| until.checked_duration_since(Instant::now()))
        else {
            return false;
        };
        self.wake.wait(self.wake.seen(), remaining).await;
        true
    }

    async fn pause_fetches(&self, blocked: &FetchBlocked) {
        tracing::warn!("Instagram refused logged-out fetches ({blocked}); pausing");
        *self.fetch_paused_until.lock().await =
            Some(Instant::now() + Duration::from_secs(INGESTION.fetch_block_pause_seconds));
        self.count("fetch_blocked").await;
    }

    async fn process_next(&self) -> Result<bool> {
        let Some(item) = items::claim(&self.pool, Stage::Ready).await? else {
            return Ok(false);
        };
        // Two posts from one club never race to edit the same listings.
        let lock = self
            .club_locks
            .lock()
            .await
            .entry(club_key(&item))
            .or_default()
            .clone();
        let _club = lock.lock().await;
        let publisher = self.publisher(&item).await?;
        let post = item
            .post
            .clone()
            .unwrap_or(Value::Object(Default::default()));
        let changed = agent::ingest(
            &self.pool,
            &post,
            &item.school,
            &item.source,
            publisher.as_deref(),
            item.carousel_requested,
        )
        .await;
        match changed {
            Ok(changed) => {
                items::mark(
                    &self.pool,
                    &item,
                    if changed { "done" } else { "not_event" },
                )
                .await?;
                self.count("processed").await;
            }
            Err(error) => {
                // Source content stays out of logs; the row is retried, then given up.
                tracing::warn!(
                    "Ingestion item failed (attempt {}): {error:#}",
                    item.attempts
                );
                items::release(&self.pool, &item, Stage::Ready, None).await?;
                self.count("failed").await;
            }
        }
        Ok(true)
    }

    async fn publisher(&self, item: &Item) -> Result<Option<String>> {
        let Some(source_id) = item.directory_source_id else {
            return Ok(None);
        };
        let mut publishers = self.publishers.lock().await;
        if publishers
            .as_ref()
            .is_none_or(|known| !known.contains_key(&source_id))
        {
            let rows: Vec<(i64, Option<String>)> =
                sqlx::query_as("SELECT id, default_club_ig FROM public.directory_sources")
                    .persistent(false)
                    .fetch_all(&self.pool)
                    .await?;
            *publishers = Some(rows.into_iter().collect());
        }
        Ok(publishers
            .as_ref()
            .and_then(|known| known.get(&source_id).cloned().flatten()))
    }
}

fn club_key(item: &Item) -> String {
    if let Some(source_id) = item.directory_source_id {
        return format!("directory:{source_id}");
    }
    let owner = item
        .post
        .as_ref()
        .and_then(|post| post.get("ownerUsername"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .trim_start_matches('@')
        .to_lowercase();
    if owner.is_empty() {
        let path = url::Url::parse(&item.source_url)
            .map(|url| url.path().to_owned())
            .unwrap_or_default();
        format!("url:{path}")
    } else {
        format!("instagram:{owner}")
    }
}

/// Fetch and process queued rows; keep waiting for more unless `wait_for_work` is off.
pub async fn process_queue(
    pool: PgPool,
    wait_for_work: bool,
    stopping: Stop,
) -> Result<BTreeMap<&'static str, u64>> {
    let directory = state_directory();
    std::fs::create_dir_all(&directory)?;
    let lock = File::options()
        .create(true)
        .append(true)
        .open(directory.join("process.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(BTreeMap::from([("busy", 1)]));
    }
    // Nothing else runs agents now, so whatever a killed run left behind can go.
    remove_leftovers(agent::WORKDIR_PREFIX);
    // An interrupted run may have left changes whose side effects never ran,
    // including rows whose agent was killed before storing their posters.
    changes::drain(&pool, true).await?;
    let processor = Arc::new(Processor {
        pool,
        stopping: stopping.clone(),
        wake: Wake::default(),
        stats: Mutex::default(),
        club_locks: Mutex::default(),
        publishers: Mutex::default(),
        fetch_paused_until: Mutex::default(),
        club_logos: Mutex::new(ClubLogos::new(directory.join("club_logos.json"))),
    });

    let lanes = |lane: Lane, count: usize| {
        (0..count)
            .map(|_| {
                let processor = Arc::clone(&processor);
                tokio::spawn(async move { processor.work(lane, wait_for_work).await })
            })
            .collect::<Vec<_>>()
    };

    if wait_for_work {
        let listener = Arc::clone(&processor);
        tokio::spawn(async move {
            let waker = Arc::clone(&listener);
            realtime::listen_for_changes(
                "ingestion_items",
                move || waker.wake.notify(),
                listener.stopping.clone(),
            )
            .await;
        });
        let mut tasks = lanes(Lane::Fetch, INGESTION.fetch_lanes);
        tasks.extend(lanes(Lane::Process, INGESTION.parallel_agents));
        tasks.extend(lanes(Lane::ClubLogos, 1));
        for task in tasks {
            task.await?;
        }
    } else {
        // A one-off run fetches everything first so agents see every post.
        for task in lanes(Lane::Fetch, INGESTION.fetch_lanes) {
            task.await?;
        }
        for task in lanes(Lane::Process, INGESTION.parallel_agents) {
            task.await?;
        }
    }
    stopping.set();
    processor.wake.notify();
    let stats = processor.stats.lock().await.clone();
    Ok(stats)
}
