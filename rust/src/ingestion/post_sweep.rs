//! The logged-out post sweep: every followed club's newest posts, read on a schedule.
//!
//! Instagram's daily digest carries about two thirds of a school's posts and its bell
//! pushes almost none (2026-11-28 audit: Berkeley's sampled clubs 1 post in 8 seen), so
//! every account a school that is not hidden follows has its public profile rendered
//! logged out (`fetch::fetch_profile_posts`, the same Lightpanda render the club logos
//! use), digest or not, and each post since its last read joins the ingestion queue like
//! a notified post. The digest stays the fast path: a post it already queued keeps its
//! row (`ingestion_items.source_url` is unique), so nothing is ingested twice.
//!
//! How often a handle is read follows how recently it posts, by the newest post its last
//! read saw (`post_sweep_schedule`; older or none, `post_sweep_dormant_read_every_hours`);
//! each read stores that and when the handle is due next in `public.instagram_post_sweep`.
//! Handles never read go first, schools taking turns, then the most overdue. A page
//! Lightpanda did not render is due again after `post_sweep_failed_retry_hours`, and a
//! page with no profile while Instagram serves others (private, gone, or seen only
//! logged in) waits like a dormant one. The list is built again every
//! `post_sweep_relist_minutes`, and a refused read is given back to be read first once
//! reads resume.
//!
//! [`Lanes`] decides how many lanes read, each one Lightpanda at a time and
//! `post_sweep_read_delay_seconds` apart: a lane fewer after `post_sweep_spike_refusals`
//! refusals within `post_sweep_spike_hours`, a lane more after `post_sweep_calm_hours`
//! with at most `post_sweep_calm_refusals`, between `post_sweep_min_lanes` and
//! `post_sweep_max_lanes`. Its state (lanes, the last change, recent refusals) is kept in
//! `post_sweep.json` in the ingestion state directory, where the watchdog reads it too.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::Result;
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use super::club_logos::normalize_handle;
use super::fetch::{GridPost, fetch_profile_posts, profile_renderer, serves_profiles};
use super::items::queue_instagram;
use crate::controlbox::INGESTION;

/// A followed handle due a read, with what its last read saw.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Due {
    pub handle: String,
    pub school: String,
    pub read_at: Option<DateTime<Utc>>,
    pub newest_post_at: Option<DateTime<Utc>>,
}

/// How a handle's read went, when Instagram did not refuse it.
#[derive(Debug, PartialEq)]
pub enum Read {
    /// Its profile rendered: the newest post in its grid, and how many posts were new.
    Profile {
        newest_post_at: Option<DateTime<Utc>>,
        queued: usize,
    },
    /// Its page showed no profile while the control profile rendered.
    NoPublicProfile,
    /// Lightpanda did not render its page.
    NotRendered,
}

impl Read {
    fn outcome(&self) -> &'static str {
        match self {
            Self::Profile { .. } => "read",
            Self::NoPublicProfile => "no_profile",
            Self::NotRendered => "not_rendered",
        }
    }
}

#[derive(Default)]
pub struct PostSweep {
    /// In reading order.
    waiting: VecDeque<Due>,
    /// Taken by a lane and not yet recorded, so a relist never hands them out twice.
    in_flight: HashSet<String>,
    listed_at: Option<Instant>,
    renderer_missing_logged: bool,
}

impl PostSweep {
    /// The next handle due a read; None when none is.
    pub async fn take_next(&mut self, pool: &PgPool) -> Result<Option<Due>> {
        if !profile_renderer().is_file() {
            if !self.renderer_missing_logged {
                tracing::warn!(renderer = %profile_renderer().display(), "post sweep waits: the profile renderer is not installed");
                self.renderer_missing_logged = true;
            }
            return Ok(None);
        }
        let backoff = Duration::from_secs(INGESTION.retry_backoff_seconds);
        let relist = Duration::from_secs(INGESTION.post_sweep_relist_minutes * 60);
        if self.listed_at.is_none_or(|listed| {
            listed.elapsed() >= relist || (self.waiting.is_empty() && listed.elapsed() >= backoff)
        }) {
            self.listed_at = Some(Instant::now());
            let in_flight = &self.in_flight;
            self.waiting = due_handles(pool)
                .await?
                .into_iter()
                .filter(|due| !in_flight.contains(&due.handle))
                .collect();
            if !self.waiting.is_empty() {
                tracing::info!(handles = self.waiting.len(), "Post sweep: handles due");
            }
        }
        let Some(due) = self.waiting.pop_front() else {
            return Ok(None);
        };
        self.in_flight.insert(due.handle.clone());
        Ok(Some(due))
    }

    /// The read was refused or failed: the handle goes back to the front, due as before.
    pub fn give_back(&mut self, due: Due) {
        self.in_flight.remove(&due.handle);
        self.waiting.push_front(due);
    }

    /// The read is recorded.
    pub fn done(&mut self, handle: &str) {
        self.in_flight.remove(handle);
    }
}

/// Read one handle's grid and queue its posts since its last read for its school. An
/// error that is `FetchBlocked` (`club_logos::is_blocked`) is Instagram refusing reads.
pub async fn read_handle(pool: &PgPool, due: &Due) -> Result<Read> {
    let posts = match fetch_profile_posts(&due.handle).await {
        Ok(Some(posts)) => posts,
        Ok(None) => return Ok(Read::NotRendered),
        // Instagram serves profiles: only this handle has none to show logged out.
        Err(_) if serves_profiles().await => return Ok(Read::NoPublicProfile),
        Err(blocked) => return Err(anyhow::Error::new(blocked)),
    };
    let now = Utc::now();
    let urls = posts_since(&posts, window_start(due.read_at, now));
    let queued = if urls.is_empty() {
        0
    } else {
        queue_instagram(pool, &urls, &due.school).await?
    };
    Ok(Read::Profile {
        newest_post_at: posts.iter().filter_map(|post| post.posted_at).max(),
        queued,
    })
}

/// Store what the read saw and when the handle is due next.
pub async fn record(pool: &PgPool, due: &Due, read: &Read) -> Result<()> {
    let now = Utc::now();
    let (read_at, newest_post_at, wait) = next_read(due, read, now);
    sqlx::query(
        "INSERT INTO public.instagram_post_sweep (handle, read_at, newest_post_at, due_at, outcome) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (handle) DO UPDATE SET read_at = EXCLUDED.read_at, \
           newest_post_at = EXCLUDED.newest_post_at, due_at = EXCLUDED.due_at, outcome = EXCLUDED.outcome",
    )
    .bind(&due.handle)
    .bind(read_at)
    .bind(newest_post_at)
    .bind(now + wait)
    .bind(read.outcome())
    .execute(pool)
    .await?;
    Ok(())
}

/// After `read`: when the handle counts as last read, its newest post known, and how long
/// until its next read. A page that did not render leaves what the last read saw.
fn next_read(
    due: &Due,
    read: &Read,
    now: DateTime<Utc>,
) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>, TimeDelta) {
    match read {
        Read::NotRendered => (
            due.read_at,
            due.newest_post_at,
            hours(INGESTION.post_sweep_failed_retry_hours),
        ),
        Read::NoPublicProfile => (Some(now), due.newest_post_at, read_every(None, now)),
        Read::Profile { newest_post_at, .. } => {
            let newest = newest_post_at.or(due.newest_post_at);
            (Some(now), newest, read_every(newest, now))
        }
    }
}

fn hours(count: u64) -> TimeDelta {
    TimeDelta::hours(i64::try_from(count).unwrap_or(i64::MAX / 3_600_000))
}

/// How often a handle whose newest post is `newest_post_at` is read.
fn read_every(newest_post_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> TimeDelta {
    let age = newest_post_at.map(|newest| now - newest);
    INGESTION
        .post_sweep_schedule
        .iter()
        .find(|tier| age.is_some_and(|age| age < TimeDelta::days(tier.newest_post_within_days)))
        .map_or(
            hours(INGESTION.post_sweep_dormant_read_every_hours),
            |tier| hours(tier.read_every_hours),
        )
}

/// The oldest post a read queues: everything since the last read, at least the last
/// `post_sweep_min_post_days` and at most the last `post_sweep_max_post_days` days.
fn window_start(read_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> DateTime<Utc> {
    let min = TimeDelta::days(INGESTION.post_sweep_min_post_days);
    let max = TimeDelta::days(INGESTION.post_sweep_max_post_days);
    now - read_at.map_or(max, |read_at| (now - read_at).clamp(min, max))
}

/// The grid's posts since `since`. A post without a date (reels often have none) takes the
/// date of the next dated post after it: below the pinned posts the grid runs newest
/// first, so it is at least that new. Pinned posts carry their own (old) dates, so they
/// never pass.
fn posts_since(posts: &[GridPost], since: DateTime<Utc>) -> Vec<String> {
    let mut urls = Vec::new();
    for (index, post) in posts.iter().enumerate() {
        let posted_at = post
            .posted_at
            .or_else(|| posts[index + 1..].iter().find_map(|later| later.posted_at));
        if posted_at.is_some_and(|at| at >= since) {
            urls.push(post.url.clone());
        }
    }
    urls
}

/// Every handle a school that is not hidden follows that is due a read, each with one of
/// its schools (the first to follow it): never read first, schools taking turns, newest
/// follows first, then the most overdue.
pub async fn due_handles(pool: &PgPool) -> Result<Vec<Due>> {
    let rows: Vec<Due> = sqlx::query_as(
        "WITH followed AS ( \
           SELECT DISTINCT ON (f.handle) f.handle, s.slug AS school, f.followed_at \
           FROM public.instagram_follow_candidates AS f \
           JOIN public.schools AS s ON s.id = f.school_id \
           WHERE f.status = 'followed' AND NOT s.hidden \
           ORDER BY f.handle, f.followed_at NULLS LAST, s.slug \
         ), due AS ( \
           SELECT f.handle, f.school, r.read_at, r.newest_post_at, r.due_at, \
             row_number() OVER (PARTITION BY f.school, r.handle IS NULL \
               ORDER BY f.followed_at DESC NULLS LAST, f.handle) AS turn \
           FROM followed AS f \
           LEFT JOIN public.instagram_post_sweep AS r ON r.handle = f.handle \
           WHERE r.handle IS NULL OR r.due_at <= now() \
         ) \
         SELECT handle, school, read_at, newest_post_at FROM due \
         ORDER BY due_at IS NOT NULL, CASE WHEN due_at IS NULL THEN turn END, due_at, school, handle",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|due| normalize_handle(&due.handle).map(|handle| Due { handle, ..due }))
        .collect())
}

/// The sweep's lanes, a refusal history and the last change, kept across restarts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct LaneState {
    lanes: usize,
    /// Seconds since the epoch.
    changed_at: f64,
    /// When Instagram refused a logged-out read (any lane's), newest last.
    refusals: Vec<f64>,
}

/// Refusals are kept this long, for the watchdog's day.
const REFUSAL_MEMORY_SECONDS: f64 = 48.0 * 3600.0;

pub struct Lanes {
    path: PathBuf,
    state: LaneState,
}

pub fn epoch_seconds() -> f64 {
    Utc::now().timestamp_millis() as f64 / 1000.0
}

impl Lanes {
    pub fn new(path: PathBuf) -> Self {
        let mut state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<LaneState>(&text).ok())
            .unwrap_or_else(|| LaneState {
                lanes: INGESTION.post_sweep_start_lanes,
                changed_at: epoch_seconds(),
                refusals: Vec::new(),
            });
        state.lanes = state.lanes.clamp(
            INGESTION.post_sweep_min_lanes,
            INGESTION.post_sweep_max_lanes,
        );
        let lanes = Self { path, state };
        // Saved at once, so the watchdog sees the lanes before the first refusal or change.
        if let Err(error) = lanes.save() {
            tracing::warn!("Post sweep lanes could not be saved ({error:#})");
        }
        lanes
    }

    /// How many lanes read now.
    pub fn active(&self) -> usize {
        self.state.lanes
    }

    /// Instagram refused a logged-out read: remember it, and read in a lane fewer when
    /// refusals spike.
    pub fn refused(&mut self, now: f64) -> Result<()> {
        self.state.refusals.push(now);
        self.state
            .refusals
            .retain(|at| *at > now - REFUSAL_MEMORY_SECONDS);
        self.adjust(now);
        self.save()
    }

    /// Read in a lane more once it has been calm long enough.
    pub fn settle(&mut self, now: f64) -> Result<()> {
        if self.adjust(now) {
            self.save()?;
        }
        Ok(())
    }

    fn adjust(&mut self, now: f64) -> bool {
        let lanes = next_lanes(&self.state, now);
        if lanes == self.state.lanes {
            return false;
        }
        tracing::warn!(
            from = self.state.lanes,
            to = lanes,
            "Post sweep lanes changed by the logged-out refusal rate"
        );
        self.state.lanes = lanes;
        self.state.changed_at = now;
        true
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&self.state)?)?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }
}

/// The lanes `state` should read in at `now`: one fewer once `post_sweep_spike_refusals`
/// refusals came within `post_sweep_spike_hours` since the last change, one more once
/// `post_sweep_calm_hours` passed since it with at most `post_sweep_calm_refusals` in them.
fn next_lanes(state: &LaneState, now: f64) -> usize {
    let within = |hours: f64, since_change: bool| {
        state
            .refusals
            .iter()
            .filter(|at| **at > now - hours * 3600.0 && (!since_change || **at > state.changed_at))
            .count()
    };
    if state.lanes > INGESTION.post_sweep_min_lanes
        && within(INGESTION.post_sweep_spike_hours, true) >= INGESTION.post_sweep_spike_refusals
    {
        return state.lanes - 1;
    }
    let calm_seconds = INGESTION.post_sweep_calm_hours * 3600.0;
    if state.lanes < INGESTION.post_sweep_max_lanes
        && now - state.changed_at >= calm_seconds
        && within(INGESTION.post_sweep_calm_hours, false) <= INGESTION.post_sweep_calm_refusals
    {
        return state.lanes + 1;
    }
    state.lanes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().unwrap()
    }

    fn post(code: &str, posted_at: Option<&str>) -> GridPost {
        GridPost {
            url: format!("https://www.instagram.com/p/{code}/"),
            posted_at: posted_at.map(at),
        }
    }

    fn due(read_at: Option<&str>, newest_post_at: Option<&str>) -> Due {
        Due {
            handle: "club".into(),
            school: "berkeley".into(),
            read_at: read_at.map(at),
            newest_post_at: newest_post_at.map(at),
        }
    }

    #[test]
    fn only_posts_since_the_window_are_queued_and_old_pinned_posts_never_are() {
        let grid = [
            post("PINNED", Some("2025-09-01T12:00:00Z")),
            post("REEL", None),
            post("NEW", Some("2026-11-15T20:00:00Z")),
            post("EDGE", Some("2026-11-14T00:00:00Z")),
            post("OLD", Some("2026-11-10T09:00:00Z")),
        ];
        assert_eq!(
            posts_since(&grid, at("2026-11-14T00:00:00Z")),
            [
                "https://www.instagram.com/p/REEL/",
                "https://www.instagram.com/p/NEW/",
                "https://www.instagram.com/p/EDGE/",
            ]
        );
    }

    #[test]
    fn an_undated_post_with_nothing_dated_after_it_is_not_queued() {
        let grid = [post("A", Some("2026-11-15T10:00:00Z")), post("B", None)];
        assert_eq!(
            posts_since(&grid, at("2026-11-14T00:00:00Z")),
            ["https://www.instagram.com/p/A/"]
        );
    }

    #[test]
    fn the_window_covers_everything_since_the_last_read_within_its_bounds() {
        let now = at("2026-11-28T12:00:00Z");
        let min = TimeDelta::days(INGESTION.post_sweep_min_post_days);
        let max = TimeDelta::days(INGESTION.post_sweep_max_post_days);
        assert_eq!(window_start(None, now), now - max);
        assert_eq!(
            window_start(Some(now - TimeDelta::hours(3)), now),
            now - min
        );
        let between = now - (min + max) / 2;
        assert_eq!(window_start(Some(between), now), between);
        assert_eq!(window_start(Some(now - max * 3), now), now - max);
    }

    #[test]
    fn a_handle_is_read_as_often_as_its_newest_post_is_recent() {
        let now = at("2026-11-28T12:00:00Z");
        let schedule = &INGESTION.post_sweep_schedule;
        for tier in schedule {
            let newest = now - TimeDelta::days(tier.newest_post_within_days) + TimeDelta::hours(1);
            assert_eq!(read_every(Some(newest), now), hours(tier.read_every_hours));
        }
        let oldest = schedule.last().unwrap().newest_post_within_days;
        let dormant = hours(INGESTION.post_sweep_dormant_read_every_hours);
        assert_eq!(
            read_every(Some(now - TimeDelta::days(oldest + 1)), now),
            dormant
        );
        assert_eq!(read_every(None, now), dormant);
        // Each slower tier is read less often than the one before.
        assert!(
            schedule
                .windows(2)
                .all(|pair| pair[0].read_every_hours < pair[1].read_every_hours)
        );
    }

    #[test]
    fn a_page_that_did_not_render_keeps_what_the_last_read_saw_and_is_due_soon() {
        let now = at("2026-11-28T12:00:00Z");
        let before = due(Some("2026-11-20T12:00:00Z"), Some("2026-11-27T12:00:00Z"));
        let (read_at, newest, wait) = next_read(&before, &Read::NotRendered, now);
        assert_eq!((read_at, newest), (before.read_at, before.newest_post_at));
        assert_eq!(wait, hours(INGESTION.post_sweep_failed_retry_hours));
        // A rendered grid with no dated post keeps the newest post known before.
        let read = Read::Profile {
            newest_post_at: None,
            queued: 0,
        };
        let (read_at, newest, wait) = next_read(&before, &read, now);
        assert_eq!((read_at, newest), (Some(now), before.newest_post_at));
        assert_eq!(wait, read_every(before.newest_post_at, now));
        let (_, newest, wait) = next_read(&due(None, None), &Read::NoPublicProfile, now);
        assert_eq!((newest, wait), (None, read_every(None, now)));
    }

    fn lanes(lanes: usize, changed_at: f64, refusals: &[f64]) -> LaneState {
        LaneState {
            lanes,
            changed_at,
            refusals: refusals.to_vec(),
        }
    }

    #[test]
    fn a_refusal_spike_takes_a_lane_away_but_not_below_the_minimum() {
        let hour = 3600.0;
        let now = 100.0 * hour;
        let spike: Vec<f64> = (0..INGESTION.post_sweep_spike_refusals)
            .map(|i| now - i as f64 * 60.0)
            .collect();
        let max = INGESTION.post_sweep_max_lanes;
        assert_eq!(next_lanes(&lanes(max, 0.0, &spike), now), max - 1);
        let min = INGESTION.post_sweep_min_lanes;
        assert_eq!(next_lanes(&lanes(min, 0.0, &spike), now), min);
        // Refusals from before the last change already took their lane.
        assert_eq!(next_lanes(&lanes(max, now, &spike), now), max);
        // One refusal short of a spike changes nothing.
        let short = &spike[1..];
        assert_eq!(next_lanes(&lanes(max, 0.0, short), now), max);
    }

    #[test]
    fn a_calm_spell_adds_a_lane_up_to_the_maximum() {
        let hour = 3600.0;
        let calm = INGESTION.post_sweep_calm_hours * hour;
        let now = 1000.0 * hour;
        let min = INGESTION.post_sweep_min_lanes;
        assert_eq!(next_lanes(&lanes(min, now - calm, &[]), now), min + 1);
        assert_eq!(next_lanes(&lanes(min, now - calm + 60.0, &[]), now), min);
        let max = INGESTION.post_sweep_max_lanes;
        assert_eq!(next_lanes(&lanes(max, 0.0, &[]), now), max);
        // More refusals than a calm spell allows, spread too thin to be a spike.
        let refusals: Vec<f64> = (0..=INGESTION.post_sweep_calm_refusals)
            .map(|i| {
                now - calm * (i as f64 + 0.5) / (INGESTION.post_sweep_calm_refusals as f64 + 1.0)
            })
            .collect();
        assert_eq!(next_lanes(&lanes(min, 0.0, &refusals), now), min);
    }

    #[test]
    fn lanes_and_refusals_survive_a_restart() {
        let path = std::env::temp_dir().join(format!("post-sweep-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut first = Lanes::new(path.clone());
        assert_eq!(first.active(), INGESTION.post_sweep_start_lanes);
        assert!(path.exists(), "a fresh start saves its lanes at once");
        first.refused(epoch_seconds()).unwrap();
        let again = Lanes::new(path.clone());
        assert_eq!(again.state, first.state);
        assert_eq!(again.state.refusals.len(), 1);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_handle_given_back_is_read_first_and_not_listed_twice_while_taken() {
        let mut sweep = PostSweep::default();
        sweep.waiting.push_back(due(None, None));
        let taken = sweep.waiting.pop_front().unwrap();
        sweep.in_flight.insert(taken.handle.clone());
        sweep.waiting.push_back(Due {
            handle: "other".into(),
            ..due(None, None)
        });
        sweep.give_back(taken);
        assert_eq!(sweep.waiting.front().unwrap().handle, "club");
        assert!(sweep.in_flight.is_empty());
        sweep.done("other");
        assert_eq!(sweep.waiting.len(), 2);
    }
}
