//! Posts of schools Instagram has gone quiet for.
//!
//! Almost every post reaches ingestion through a notification: the daily
//! `subscription_daily_digest` push or a per-post bell push. Instagram decides when to
//! send those, and some days a school gets none at all (TMU on 2026-11-15, with eleven
//! others). So a school whose last `post` or digest notification is older than
//! `quiet_school_hours` has its followed clubs' public profiles rendered logged out
//! (`fetch::fetch_profile_posts`, the same Lightpanda render the club logos use), and
//! each post from the last `quiet_school_post_days` days joins the ingestion queue like
//! a notified post. A post already queued keeps its row, so nothing is read twice.
//!
//! Only clubs with an event within `quiet_school_active_days`, or followed within
//! `quiet_school_new_follow_days`, are read, one per lane at a time,
//! `quiet_school_read_delay_seconds` apart. Quiet schools take turns, one club each, so
//! every one of them is covered early; within a school the newest events go first.
//! A handle is read again only after `quiet_school_reread_hours`. The list is built
//! again every `quiet_school_relist_minutes`, so a school that goes quiet joins it
//! without waiting behind the clubs listed before, and a refused read is given back
//! to be read first once reads resume.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use indexmap::IndexMap;
use sqlx::PgPool;

use super::club_logos::normalize_handle;
use super::fetch::{GridPost, fetch_profile_posts, profile_renderer};
use super::items::queue_instagram;
use crate::controlbox::INGESTION;

/// A handle taken to read, with when it was last read before, to give it back.
pub struct Taken {
    pub handle: String,
    pub school: String,
    previous: Option<f64>,
}

pub struct QuietSchools {
    state_path: PathBuf,
    read_at: HashMap<String, f64>,
    /// Handle -> school slug, in reading order.
    waiting: IndexMap<String, String>,
    listed_at: Option<Instant>,
    renderer_missing_logged: bool,
}

fn epoch_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

impl QuietSchools {
    pub fn new(state_path: PathBuf) -> Self {
        let read_at = std::fs::read_to_string(&state_path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            state_path,
            read_at,
            waiting: IndexMap::new(),
            listed_at: None,
            renderer_missing_logged: false,
        }
    }

    /// The next handle to read and its school, marked as read now so another lane
    /// (and a refused read) moves on; None when no quiet school has one due.
    pub async fn take_next(&mut self, pool: &PgPool) -> Result<Option<Taken>> {
        if !profile_renderer().is_file() {
            if !self.renderer_missing_logged {
                tracing::warn!(renderer = %profile_renderer().display(), "quiet school reads wait: the profile renderer is not installed");
                self.renderer_missing_logged = true;
            }
            return Ok(None);
        }
        let backoff = Duration::from_secs(INGESTION.retry_backoff_seconds);
        let relist = Duration::from_secs(INGESTION.quiet_school_relist_minutes * 60);
        if self.listed_at.is_none_or(|listed| {
            listed.elapsed() >= relist || (self.waiting.is_empty() && listed.elapsed() >= backoff)
        }) {
            self.listed_at = Some(Instant::now());
            let due_before = epoch_seconds() - (INGESTION.quiet_school_reread_hours * 3600) as f64;
            self.waiting = quiet_school_handles(pool)
                .await?
                .into_iter()
                .filter(|(handle, _)| self.read_at.get(handle).copied().unwrap_or(0.0) < due_before)
                .collect();
            if !self.waiting.is_empty() {
                tracing::info!(handles = self.waiting.len(), "Reading quiet schools' clubs");
            }
        }
        let Some((handle, school)) = self.waiting.shift_remove_index(0) else {
            return Ok(None);
        };
        let previous = self.read_at.insert(handle.clone(), epoch_seconds());
        self.save()?;
        Ok(Some(Taken {
            handle,
            school,
            previous,
        }))
    }

    /// Instagram refused the read: the handle goes back to the front, due as before.
    pub fn give_back(&mut self, taken: Taken) -> Result<()> {
        match taken.previous {
            Some(read_at) => self.read_at.insert(taken.handle.clone(), read_at),
            None => self.read_at.remove(&taken.handle),
        };
        self.waiting.shift_insert(0, taken.handle, taken.school);
        self.save()
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.state_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.state_path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&self.read_at)?)?;
        std::fs::rename(&temporary, &self.state_path)?;
        Ok(())
    }
}

/// Read one handle's grid and queue its recent posts for the school; how many were new.
pub async fn read_handle(pool: &PgPool, handle: &str, school: &str) -> Result<usize> {
    let posts = fetch_profile_posts(handle)
        .await
        .map_err(anyhow::Error::new)?;
    let today = chrono::Utc::now().date_naive();
    let urls = recent_posts(&posts, today, INGESTION.quiet_school_post_days);
    if urls.is_empty() {
        return Ok(0);
    }
    queue_instagram(pool, &urls, school).await
}

/// The grid's posts from the last `days` days. A post without a date (reels often have
/// none) takes the date of the next dated post after it: below the pinned posts the
/// grid runs newest first, so it is at least that new. Pinned posts carry their own
/// (old) dates, so they never pass.
fn recent_posts(posts: &[GridPost], today: chrono::NaiveDate, days: i64) -> Vec<String> {
    let since = today - chrono::Duration::days(days);
    let mut urls = Vec::new();
    for (index, post) in posts.iter().enumerate() {
        let posted_on = post
            .posted_on
            .or_else(|| posts[index + 1..].iter().find_map(|later| later.posted_on));
        if posted_on.is_some_and(|day| day >= since) {
            urls.push(post.url.clone());
        }
    }
    urls
}

/// Active followed accounts (an event within `quiet_school_active_days`, or followed
/// within `quiet_school_new_follow_days`) of every school without a `post` or digest
/// notification for `quiet_school_hours`, by handle. Schools take turns, one club each,
/// quietest school first, and each school's clubs with the newest events go first.
async fn quiet_school_handles(pool: &PgPool) -> Result<IndexMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "WITH last_post AS ( \
           SELECT s.id, s.slug, max(n.first_seen_at) AS seen \
           FROM public.schools AS s \
           LEFT JOIN public.instagram_notifications AS n ON n.school_id = s.id \
             AND n.push_category IN ('post', 'subscription_daily_digest') \
             AND n.first_seen_at > now() - interval '30 days' \
           GROUP BY s.id, s.slug \
         ), quiet AS ( \
           SELECT * FROM last_post \
           WHERE seen IS NULL OR seen < now() - make_interval(hours => $1) \
         ), club_activity AS ( \
           SELECT c.school_id, lower(c.ig) AS handle, max(e.added_at) AS newest \
           FROM public.clubs AS c JOIN public.events AS e ON e.club_id = c.id \
           WHERE c.school_id IN (SELECT id FROM quiet) AND c.ig IS NOT NULL \
           GROUP BY c.school_id, lower(c.ig) \
         ), active AS ( \
           SELECT f.handle, q.slug, q.seen, \
             row_number() OVER (PARTITION BY f.school_id ORDER BY a.newest DESC NULLS LAST, f.handle) AS turn \
           FROM public.instagram_follow_candidates AS f \
           JOIN quiet AS q ON q.id = f.school_id \
           LEFT JOIN club_activity AS a ON a.school_id = f.school_id AND a.handle = lower(f.handle) \
           WHERE f.status = 'followed' \
             AND (a.newest > now() - make_interval(days => $2) \
               OR f.followed_at > now() - make_interval(days => $3)) \
         ) \
         SELECT handle, slug FROM active ORDER BY turn, seen NULLS FIRST, slug",
    )
    .bind(i32::try_from(INGESTION.quiet_school_hours).unwrap_or(i32::MAX))
    .bind(INGESTION.quiet_school_active_days)
    .bind(INGESTION.quiet_school_new_follow_days)
    .fetch_all(pool)
    .await?;
    let mut handles = IndexMap::new();
    for (handle, school) in rows {
        if let Some(handle) = normalize_handle(&handle) {
            handles.entry(handle).or_insert(school);
        }
    }
    Ok(handles)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn post(code: &str, posted_on: Option<&str>) -> GridPost {
        GridPost {
            url: format!("https://www.instagram.com/p/{code}/"),
            posted_on: posted_on.map(day),
        }
    }

    #[test]
    fn only_the_last_days_posts_are_queued_and_old_pinned_posts_never_are() {
        let grid = [
            post("PINNED", Some("2025-09-01")),
            post("REEL", None),
            post("NEW", Some("2026-11-15")),
            post("EDGE", Some("2026-11-14")),
            post("OLD", Some("2026-11-10")),
        ];
        assert_eq!(
            recent_posts(&grid, day("2026-11-16"), 2),
            [
                "https://www.instagram.com/p/REEL/",
                "https://www.instagram.com/p/NEW/",
                "https://www.instagram.com/p/EDGE/",
            ]
        );
    }

    #[test]
    fn a_refused_read_goes_back_first_and_due_as_before() {
        let path = std::env::temp_dir().join(format!("quiet-schools-{}.json", std::process::id()));
        let mut quiet = QuietSchools::new(path.clone());
        quiet.read_at.insert("readbefore".into(), 5.0);
        quiet.waiting.insert("other".into(), "mit".into());
        for (handle, previous) in [("readbefore", Some(5.0)), ("never", None)] {
            quiet
                .give_back(Taken {
                    handle: handle.into(),
                    school: "carleton".into(),
                    previous,
                })
                .unwrap();
            assert_eq!(quiet.waiting.get_index(0).unwrap().0, handle);
            assert_eq!(quiet.read_at.get(handle).copied(), previous);
        }
        assert_eq!(quiet.waiting.len(), 3);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_undated_post_with_nothing_dated_after_it_is_not_queued() {
        let grid = [post("A", Some("2026-11-15")), post("B", None)];
        assert_eq!(
            recent_posts(&grid, day("2026-11-16"), 2),
            ["https://www.instagram.com/p/A/"]
        );
    }
}
