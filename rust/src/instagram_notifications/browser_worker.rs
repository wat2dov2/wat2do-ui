//! Single browser executor with bounded jobs and independent carousel polling.

use std::collections::HashSet;
use std::fs::File;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use fs2::FileExt;
use serde_json::{Value, json};

use super::browser_digest;
use super::browser_engagement;
use super::browser_following;
use super::browser_ingestion;
use super::browser_queue::{BrowserJob, BrowserJobQueue, Finish, read_only_kind};
use super::browser_session::{
    ACCOUNT_UNAVAILABLE, Bridge, BrowserInstagramSession, BrowserTabPool, CANCELLATION_UNCONFIRMED,
    LOGGED_OUT_PAUSE, TabPool, make_interruptible, request_stop, school_account_username,
    stop_requested, with_job_deadline,
};
use super::carousel_engagement;
use super::errors::{BrowserError, BrowserResult, SessionKind};
use super::profile_retrieval;
use crate::controlbox::{InheritedControls, instagram_browser as control};
use crate::db::BlockingPool;
use crate::host::Event;
use crate::pyjson::{self, truthy};

/// Shared with every process that drives the worker's Brave windows.
pub const BROWSER_LOCK_PATH: &str = "/tmp/wat2do_instagram_browser.lock";

const SQLITE_BUSY: i32 = 5;
const SQLITE_LOCKED: i32 = 6;
const SQLITE_READONLY: i32 = 8;
const SQLITE_FULL: i32 = 13;
const INTERRUPTED_PAUSE: &str = "Worker interrupted; inspect browser state before resuming";
const STOPPED_DURING_JOB: &str = "Worker stopped during job; inspect before retrying";

/// Classify queue failures by SQLite's code without exposing SQL or file paths.
pub fn storage_failure_reason(error: &BrowserError) -> Option<&'static str> {
    let BrowserError::Storage(storage) = error else {
        return None;
    };
    Some(match storage.primary_code() {
        Some(SQLITE_FULL) => "Browser queue storage is full; free disk space before resuming",
        Some(SQLITE_BUSY | SQLITE_LOCKED) => {
            "Browser queue storage is locked; inspect competing queue writers before resuming"
        }
        Some(SQLITE_READONLY) => {
            "Browser queue storage is read-only; restore write access before resuming"
        }
        _ => "Browser queue storage is unavailable; inspect before resuming",
    })
}

fn failure_reason(error: &BrowserError, what: &str) -> String {
    storage_failure_reason(error)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            format!(
                "{what} failed ({}); inspect before retrying",
                error.type_name()
            )
        })
}

/// Jobs that only read Instagram: nothing they leave in flight can change anything.
fn read_only(job: &BrowserJob) -> bool {
    read_only_kind(&job.kind)
}

/// Pause for a person on account trouble or an action that may still go through.
///
/// A read-only job whose cancellation cannot be confirmed fails and retries instead:
/// its leftover request cannot like, repost or send anything. Any other unconfirmed
/// cancellation pauses until [`Worker::confirm_cancellation`] sees every tab settle.
pub fn requires_human_recovery(error: &BrowserError, job: &BrowserJob) -> bool {
    if error.is(SessionKind::EngagementUncertain) {
        return true;
    }
    let message = error.to_string();
    if message.contains(CANCELLATION_UNCONFIRMED) {
        return !read_only(job);
    }
    message.contains("human account recovery") || message.contains("human reauthorization")
}

/// Every logout pause shares this prefix; a challenge is recognized on the page.
pub fn is_logout(paused: &Value) -> bool {
    let prefix = LOGGED_OUT_PAUSE.split(':').next().unwrap_or_default();
    paused
        .as_str()
        .is_some_and(|paused| paused.starts_with(prefix))
}

/// How long after the latest of `attempts` (the last day's recovery attempts, it
/// included) the next may start: `login_recovery_interval_seconds`, doubled for each
/// other attempt within `login_recovery_backoff_window_seconds`, never more than
/// `login_recovery_max_interval_seconds`.
pub fn recovery_spacing(attempts: &[Value], now: f64) -> f64 {
    let window = control().login_recovery_backoff_window_seconds;
    let recent = attempts
        .iter()
        .filter(|at| pyjson::number(at).is_some_and(|at| now - at < window))
        .count();
    let doublings = i32::try_from(recent.saturating_sub(1).min(30)).unwrap_or(30);
    (control().login_recovery_interval_seconds * 2f64.powi(doublings))
        .min(control().login_recovery_max_interval_seconds)
}

/// Run one claimed job on `session`; `on_rate_limit` hears a verified 429 at once.
pub type ExecuteJob = dyn Fn(
        &BrowserJob,
        &mut BrowserInstagramSession,
        Option<&dyn Fn(&BrowserError)>,
    ) -> BrowserResult<Value>
    + Send
    + Sync;

/// Open the worker's tab pool.
pub type TabPoolFactory = dyn Fn(&Worker) -> Box<dyn TabPool> + Send + Sync;
/// Collect newly published carousels' sources (the source poller's work).
pub type CarouselCollector = dyn Fn(&Worker) -> anyhow::Result<Value> + Send + Sync;
/// The school account's current name for a recipient ID, if the database knows it.
pub type SchoolAccountLookup = dyn Fn(&str) -> Option<String> + Send + Sync;
type PendingCleanup = (
    BrowserJob,
    Arc<Mutex<BrowserInstagramSession>>,
    BrowserError,
);

/// The parts tests replace; production uses [`Worker::new`]'s defaults.
#[derive(Clone)]
pub struct Seams {
    pub execute_job: Arc<ExecuteJob>,
    pub tab_pool: Arc<TabPoolFactory>,
    pub school_account_for: Arc<SchoolAccountLookup>,
    pub collect_carousels: Arc<CarouselCollector>,
    pub browser_lock_path: PathBuf,
}

/// Everything one worker process shares between its threads.
#[derive(Clone)]
pub struct Worker {
    pub bridge: Arc<Bridge>,
    pub queue: Arc<BrowserJobQueue>,
    pub db: Option<Arc<BlockingPool>>,
    pub seams: Seams,
}

impl Worker {
    pub fn new(
        bridge: Arc<Bridge>,
        queue: Arc<BrowserJobQueue>,
        db: Option<Arc<BlockingPool>>,
    ) -> Self {
        let lookup_db = db.clone();
        Self {
            bridge,
            queue,
            db,
            seams: Seams {
                execute_job: Arc::new(execute_job),
                tab_pool: Arc::new(|worker: &Worker| {
                    Box::new(BrowserTabPool::new(
                        worker.bridge.clone(),
                        worker.queue.clone(),
                    )) as Box<dyn TabPool>
                }),
                school_account_for: Arc::new(move |recipient_id: &str| {
                    let db = lookup_db.as_ref()?;
                    let recipient_id = recipient_id.to_owned();
                    // Asked while Brave's lock is held: a short wait, then the queued name.
                    let school = db
                        .run_within(std::time::Duration::from_secs(5), |pool| async move {
                            crate::schools::by_recipient_id(&pool, &recipient_id).await
                        })
                        // Keep the queued name when the database is unreachable.
                        .ok()??;
                    school_account_username(&school.slug).ok()
                }),
                collect_carousels: Arc::new(|worker: &Worker| {
                    carousel_engagement::sync_published_carousels(
                        &worker.queue,
                        worker.database()?,
                        None,
                    )
                }),
                browser_lock_path: PathBuf::from(BROWSER_LOCK_PATH),
            },
        }
    }

    fn tab_pool(&self) -> Box<dyn TabPool> {
        (self.seams.tab_pool)(self)
    }

    fn time(&self) -> f64 {
        self.bridge.time()
    }

    /// Take the shared browser lock without waiting; None while another process holds it.
    fn try_browser_lock(&self) -> BrowserResult<Option<File>> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&self.seams.browser_lock_path)
            .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(file)),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(BrowserError::other("OSError", error.to_string())),
        }
    }

    fn browser_lock(&self) -> BrowserResult<File> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&self.seams.browser_lock_path)
            .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        file.lock_exclusive()
            .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        Ok(file)
    }

    /// A digest rerun replays an old commit, which may queue an account's former name.
    fn with_current_account(&self, job: BrowserJob) -> BrowserJob {
        if job.kind != "digest" {
            return job;
        }
        let Some(username) = (self.seams.school_account_for)(&job.recipient_id) else {
            return job;
        };
        if username == job.account_username {
            return job;
        }
        tracing::info!(
            "Digest {} uses {}, the current name of {}",
            job.id,
            username,
            job.account_username
        );
        BrowserJob {
            account_username: username,
            ..job
        }
    }

    /// Claim only after browser ownership; a waiting digest can overtake any like.
    pub fn process_next_job(&self, allow_engagement: bool) -> BrowserResult<bool> {
        let queue = &self.queue;
        if queue.paused()? {
            return Ok(false);
        }
        let Some(lock) = self.try_browser_lock()? else {
            return Ok(false);
        };
        let processed = self.process_claimed(allow_engagement);
        let _ = FileExt::unlock(&lock);
        processed
    }

    fn process_claimed(&self, allow_engagement: bool) -> BrowserResult<bool> {
        let queue = &self.queue;
        let next_engagement = queue
            .setting_or("next_engagement_at", json!(0))?
            .as_f64()
            .unwrap_or(0.0);
        let Some(job) =
            queue.claim_next(None, allow_engagement && self.time() >= next_engagement)?
        else {
            return Ok(false);
        };
        let job = self.with_current_account(job);
        queue.record_diagnostic("running", Some(&job), None);
        if queue.is_storage_unavailable() {
            return Ok(false);
        }
        let limit = control().parallel_tabs.saturating_sub(2) as i64;
        let companions = queue.claim_companions(&job, limit, allow_engagement)?;
        if !companions.is_empty() || read_only(&job) {
            let mut jobs = vec![job];
            jobs.extend(
                companions
                    .into_iter()
                    .map(|companion| self.with_current_account(companion)),
            );
            self.process_batch(jobs, allow_engagement)?;
            return Ok(true);
        }
        let engaging = job.kind == "engagement" && !job.dry_run();
        let outcome = with_job_deadline(&self.bridge, control().job_timeout_seconds, || {
            self.execute_on_primary_tab(&job)
        })
        .and_then(|result| queue.finish(&job, Finish::result(result)));
        let handled = match outcome {
            Ok(()) => Ok(()),
            Err(error) if error.is(SessionKind::RateLimited) => queue
                .defer_for_rate_limit(Some(&job), &error.to_string())
                .and_then(|()| queue.finish(&job, Finish::error(error.to_string()))),
            Err(error) if error.is_session() || error.is_timeout() => {
                let paused = if requires_human_recovery(&error, &job) {
                    queue.set_setting("paused", Value::from(error.to_string()))
                } else {
                    Ok(())
                };
                paused.and_then(|()| queue.finish(&job, Finish::error(error.to_string())))
            }
            Err(BrowserError::Interrupted) => queue
                .set_setting("paused", Value::from(INTERRUPTED_PAUSE))
                .and_then(|()| queue.finish(&job, Finish::error(STOPPED_DURING_JOB)))
                .and(Err(BrowserError::Interrupted)),
            Err(error) if error.is_storage() => {
                queue.set_storage_unavailable(true);
                if engaging {
                    // set_setting retains this safety hold until storage returns.
                    let _ = queue.set_setting(
                        "paused",
                        Value::from(
                            "Engagement completion could not be stored; inspect browser state before resuming",
                        ),
                    );
                }
                tracing::warn!("Browser job {} is waiting for queue storage", job.id);
                Err(error)
            }
            Err(error) => {
                // Never persist raw library exceptions that may include request credentials.
                let reason = failure_reason(&error, "Browser job");
                tracing::error!("Browser job {} failed: {reason}", job.id);
                queue
                    .set_setting("paused", Value::from(reason.clone()))
                    .and_then(|()| queue.finish(&job, Finish::error(reason)))
            }
        };
        let finally: BrowserResult<()> = (|| {
            if let Some(completed) = queue.get(&job.id)? {
                queue.record_diagnostic(&completed.state, Some(&completed), None);
            }
            if engaging {
                queue.set_setting(
                    "next_engagement_at",
                    json!(self.time() + control().engagement_interval_seconds),
                )?;
            }
            Ok(())
        })();
        finally?;
        handled?;
        Ok(true)
    }

    /// Likes and reposts act as the school on the first tab, after every tab settles.
    fn execute_on_primary_tab(&self, job: &BrowserJob) -> BrowserResult<Value> {
        let pool = self.tab_pool();
        match pool.settle_registered_tabs() {
            Err(error) if error.is(SessionKind::TabUnavailable) => {
                pool.ensure_capacity(None)?;
                pool.settle_registered_tabs()?;
            }
            other => {
                other?;
            }
        }
        let first = match self.queue.setting_or("browser_tab_ids", json!([]))? {
            Value::Array(ids) => ids.first().map(pyjson::str),
            _ => None,
        };
        let mut session = match first {
            None => BrowserInstagramSession::unpinned(&self.bridge),
            Some(tab_id) => BrowserInstagramSession::on_tab(&self.bridge, &tab_id, true, None),
        };
        (self.seams.execute_job)(job, &mut session, None)
    }

    /// Drain the bounded tab batch before releasing ownership or switching accounts.
    fn process_batch(&self, jobs: Vec<BrowserJob>, allow_engagement: bool) -> BrowserResult<()> {
        Batch::new(self.clone(), jobs, allow_engagement).run()
    }

    /// Log back in once spacing allows; the browser lock is held.
    ///
    /// Each attempt waits `login_recovery_interval_seconds` after the last, doubled for
    /// every other attempt within `login_recovery_backoff_window_seconds` and never more
    /// than `login_recovery_max_interval_seconds`, so a flagged browser is not hammered
    /// and Brave is never left logged out for the rest of a day (a daily cap did that on
    /// 11-13: every school's digests failed from 10:17 to 21:51).
    pub fn attempt_login_recovery(&self, now: &dyn Fn() -> f64) -> BrowserResult<bool> {
        let queue = &self.queue;
        let attempts = super::browser_queue::recent_timestamps(
            &queue.setting_or("login_recovery_attempts", json!([]))?,
            now(),
        );
        let next_at =
            pyjson::number(&queue.setting_or("login_recovery_next_at", json!(0))?).unwrap_or(0.0);
        if now() < next_at {
            return Ok(false);
        }
        let mut spent = attempts.clone();
        spent.push(json!(now()));
        let spacing = recovery_spacing(&spent, now());
        queue.set_setting("login_recovery_attempts", Value::from(spent))?;
        queue.set_setting("login_recovery_next_at", json!(now() + spacing))?;
        match self.tab_pool().recover_login() {
            Ok(username) => {
                tracing::warn!("Logged back in to Instagram as {username} after a logout");
                queue.set_setting("paused", Value::Bool(false))?;
                Ok(true)
            }
            Err(error)
                if error.is_timeout()
                    || error.is(SessionKind::AutomationTransient)
                    || error.is(SessionKind::PageUnavailable)
                    || error.is(SessionKind::TabUnavailable) =>
            {
                // A Brave hiccup is not a login Instagram saw: it does not count toward
                // the backoff. Try again soon.
                queue.set_setting("login_recovery_attempts", Value::from(attempts))?;
                queue.set_setting(
                    "login_recovery_next_at",
                    json!(now() + control().login_recovery_retry_seconds),
                )?;
                queue.set_setting("paused", Value::from(LOGGED_OUT_PAUSE))?;
                tracing::warn!(
                    "Instagram login recovery did not finish ({error}); retrying shortly"
                );
                Ok(false)
            }
            // No saved profile got back in: one whose password cannot go out today, a
            // challenge, or a login that did not finish. The pool holds an account whose
            // password went out or that Instagram challenged; Brave stays logged out and
            // the next attempt tries the other saved profiles, so every school's work
            // waits for the backoff, never for a person (11-12/13).
            Err(error) if error.is_session() => {
                tracing::error!(
                    "Instagram login recovery did not get back in ({error}); trying again in {} minutes",
                    (spacing / 60.0).round()
                );
                queue.set_setting("paused", Value::from(LOGGED_OUT_PAUSE))?;
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Log in an account missing from Brave, at most once a day per account and
    /// `account_login_daily_limit` a day in all; the browser lock is held. The pool
    /// records each login just before its password goes out, so a failure before that
    /// leaves the account to try again.
    pub fn attempt_account_login(
        &self,
        username: &str,
        now: &dyn Fn() -> f64,
    ) -> BrowserResult<bool> {
        if !self.queue.account_login_allowed(username, now())? {
            return Ok(false);
        }
        match self.tab_pool().add_account(username) {
            Ok(()) => {
                tracing::warn!("Logged {username} in to Brave after it went missing");
                Ok(true)
            }
            // Its password reached Instagram: a person looks before this account logs in
            // again. Only this account waits; every other school's work runs on (a
            // two-step code sent to a phone once paused every digest for days).
            Err(error) if error.is(SessionKind::LoginSubmitted) => {
                tracing::error!(
                    "Logging {username} in to Brave needs a person; its jobs fail until \
                     `wat2do-browser resume-account --account {username}`: {error}"
                );
                self.queue
                    .pause_account_login(username, &error.to_string())?;
                Ok(false)
            }
            Err(error) if error.is_session() || error.is_timeout() => {
                tracing::error!("Logging {username} in to Brave did not finish: {error}");
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Log back in after Instagram logs Brave out; true once browser work may resume.
    ///
    /// Spaced by a growing backoff so a flagged browser is not hammered with logins; an
    /// account that needs a person is held alone and the other saved profiles are tried.
    pub fn recover_login(&self, now: &dyn Fn() -> f64) -> BrowserResult<bool> {
        if !is_logout(&self.queue.setting_or("paused", Value::Bool(false))?) {
            return Ok(false);
        }
        let Some(lock) = self.try_browser_lock()? else {
            return Ok(false);
        };
        let recovered = self.attempt_login_recovery(now);
        let _ = FileExt::unlock(&lock);
        recovered
    }

    /// Lift a pause for an unconfirmed cancellation once every worker tab has settled.
    ///
    /// A like or repost whose page request Brave could not cancel in time (a busy Mac
    /// stalls Brave) pauses all browser work so that request cannot act later. Settling
    /// the tabs again is the confirmation the job ran out of time for, so the worker
    /// keeps trying it instead of failing every school's digests until a person resumes.
    /// The failed engagement is never replayed. True once browser work may resume.
    pub fn confirm_cancellation(&self, now: &dyn Fn() -> f64) -> BrowserResult<bool> {
        let queue = &self.queue;
        let paused = queue.setting_or("paused", Value::Bool(false))?;
        if !paused
            .as_str()
            .is_some_and(|reason| reason.contains(CANCELLATION_UNCONFIRMED))
        {
            return Ok(false);
        }
        let next_at = pyjson::number(&queue.setting_or("cancellation_confirm_next_at", json!(0))?)
            .unwrap_or(0.0);
        if now() < next_at {
            return Ok(false);
        }
        let Some(lock) = self.try_browser_lock()? else {
            return Ok(false);
        };
        let settled = self.tab_pool().settle_registered_tabs();
        let _ = FileExt::unlock(&lock);
        match settled {
            // A closed or replaced worker tab took its document's request with it.
            Ok(_) => {}
            Err(error) if error.is(SessionKind::TabUnavailable) => {}
            Err(error) if error.is_storage() || error.is_interrupted() => return Err(error),
            Err(error) => {
                queue.set_setting(
                    "cancellation_confirm_next_at",
                    json!(now() + control().cancellation_confirm_retry_seconds),
                )?;
                // Only sanitized browser messages are logged, never a library's raw text.
                let reason = if error.is_session() || error.is_timeout() {
                    error.to_string()
                } else {
                    error.type_name()
                };
                tracing::warn!(
                    "Interrupted Instagram request is still unconfirmed ({reason}); checking again shortly"
                );
                return Ok(false);
            }
        }
        if !queue.compare_set_pause(&paused, &Value::Bool(false))? {
            return Ok(false);
        }
        tracing::warn!("Interrupted Instagram request settled; browser work resumes");
        Ok(true)
    }

    /// Admit work only after restoring the configured pool without changing accounts.
    pub fn maintain_tab_pool(&self) -> BrowserResult<bool> {
        let queue = &self.queue;
        if queue.paused()? || queue.is_rate_limited(None, false)? {
            return Ok(false);
        }
        let Some(lock) = self.try_browser_lock()? else {
            return Ok(false);
        };
        let maintained = (|| {
            if !queue.paused()? && !queue.is_rate_limited(None, false)? {
                self.tab_pool().ensure_capacity(None)?;
                return Ok(true);
            }
            Ok(false)
        })();
        let _ = FileExt::unlock(&lock);
        match maintained {
            Ok(ready) => Ok(ready),
            Err(error) if error.is(SessionKind::RateLimited) => {
                queue.defer_for_rate_limit(None, &error.to_string())?;
                Ok(false)
            }
            Err(error) if error.is_timeout() || error.is(SessionKind::AutomationTransient) => {
                tracing::warn!(
                    "Tab maintenance deferred: browser bridge or account identity is temporarily unavailable"
                );
                Ok(false)
            }
            Err(error) if error.is(SessionKind::TabUnavailable) => {
                // Someone closed or browsed away from a worker window mid-repair.
                tracing::warn!("Tab maintenance deferred: a worker window changed during repair");
                Ok(false)
            }
            Err(error) if error.is(SessionKind::PageUnavailable) => {
                // A page that has not laid out yet (a hidden or busy window) settles by
                // itself; pausing here left every school failing until a person resumed.
                tracing::warn!("Tab maintenance deferred: {error}");
                Ok(false)
            }
            Err(error) if error.is_session() => {
                queue.set_setting("paused", Value::from(error.to_string()))?;
                Ok(false)
            }
            Err(error) if error.is_storage() => {
                queue.set_storage_unavailable(true);
                Err(error)
            }
            Err(BrowserError::Interrupted) => Err(BrowserError::Interrupted),
            Err(error) => {
                let reason = failure_reason(&error, "Worker tab maintenance");
                tracing::error!("{reason}");
                queue.set_setting("paused", Value::from(reason))?;
                Ok(false)
            }
        }
    }

    /// Prove tab settlement and durable storage before any interrupted read can retry.
    pub fn recover_worker_queue(&self) -> BrowserResult<()> {
        let lock = self.browser_lock()?;
        let recovered = (|| {
            match self.tab_pool().settle_registered_tabs() {
                Ok(_) => {}
                Err(error) if error.is(SessionKind::TabUnavailable) => {
                    tracing::warn!(
                        "Worker windows are missing; they are reopened before the next job"
                    );
                }
                Err(error) if error.is(SessionKind::AutomationTransient) => {
                    tracing::warn!("Brave is unavailable; the worker waits for it");
                }
                Err(error) if error.is(SessionKind::PageUnavailable) => {
                    tracing::warn!(
                        "Worker tabs are not ready yet ({error}); they are repaired before the next job"
                    );
                }
                Err(error) if error.is_session() => {
                    self.queue
                        .set_setting("paused", Value::from(error.to_string()))?;
                }
                Err(error) => return Err(error),
            }
            self.queue.recover_interrupted()
        })();
        let _ = FileExt::unlock(&lock);
        recovered
    }

    /// Run the singleton; `once` processes existing queue work without collecting.
    pub fn run(&self, once: bool, collect: bool, terminate: Arc<Event>) -> BrowserResult<()> {
        let lock_path = self.queue.state_directory.join("worker.lock");
        let worker_lock = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&lock_path)
            .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        if worker_lock.try_lock_exclusive().is_err() {
            return Err(BrowserError::other(
                "RuntimeError",
                "Instagram browser worker is already running",
            ));
        }
        make_interruptible();
        // A lane from an earlier run is gone: its running jobs are this recovery's.
        self.queue.reset_lightpanda_lane()?;
        let stopping = Arc::new(Event::default());
        let mut threads: Vec<JoinHandle<()>> = vec![self.keep_worker_alive(stopping.clone())];
        let mut collecting = false;
        let result = (|| {
            let mut next_tab_check = 0.0;
            let mut tab_pool_ready = false;
            let mut needs_recovery = true;
            loop {
                let step = (|| {
                    if needs_recovery || self.queue.is_storage_unavailable() {
                        tab_pool_ready = false;
                        next_tab_check = 0.0;
                        self.queue.set_setting(
                            "worker",
                            json!({"running": true, "heartbeat": self.time()}),
                        )?;
                        self.recover_worker_queue()?;
                        needs_recovery = false;
                        if collect && !once && !collecting {
                            threads.extend(self.source_pollers(stopping.clone()));
                            collecting = true;
                        }
                    }
                    if self.bridge.monotonic() >= next_tab_check {
                        let time = || self.time();
                        if self.recover_login(&time)? || self.confirm_cancellation(&time)? {
                            next_tab_check = 0.0;
                        }
                        tab_pool_ready = self.maintain_tab_pool()?;
                        next_tab_check = self.bridge.monotonic()
                            + if tab_pool_ready {
                                control().tab_health_interval_seconds
                            } else {
                                control().worker_poll_interval_seconds
                            };
                    }
                    if tab_pool_ready {
                        self.process_next_job(true)
                    } else {
                        Ok(false)
                    }
                })();
                let worked = match step {
                    Ok(worked) => worked,
                    Err(error) if error.is_storage() => {
                        // Storage pressure is an admission hold, never an auth pause.
                        // Existing engagements recover as uncertain and require inspection.
                        needs_recovery = true;
                        self.queue.set_storage_unavailable(true);
                        tracing::warn!(
                            "Browser worker waiting for storage: {}",
                            storage_failure_reason(&error).unwrap_or_default()
                        );
                        if once {
                            return Err(error);
                        }
                        if terminate.wait(control().storage_retry_interval_seconds)
                            || stop_requested()
                        {
                            return Ok(());
                        }
                        continue;
                    }
                    Err(BrowserError::Interrupted) => return Ok(()),
                    Err(error) => return Err(error),
                };
                if once {
                    return Ok(());
                }
                if !worked
                    && (terminate.wait(control().worker_poll_interval_seconds) || stop_requested())
                {
                    return Ok(());
                }
                if stop_requested() {
                    return Ok(());
                }
            }
        })();
        stopping.set();
        let shutdown_deadline = self.bridge.monotonic() + control().request_timeout_seconds;
        for thread in threads {
            join_until(thread, &self.bridge, shutdown_deadline);
        }
        if let Err(error) = self.queue.set_setting(
            "worker",
            json!({"running": false, "heartbeat": self.time()}),
        ) {
            tracing::warn!(
                "Could not record browser worker shutdown: {}",
                storage_failure_reason(&error).unwrap_or_default()
            );
        }
        result
    }

    /// Browser preparation and source HTTP calls cannot delay worker liveness.
    fn keep_worker_alive(&self, stopping: Arc<Event>) -> JoinHandle<()> {
        let worker = self.clone();
        spawn_named("instagram-browser-heartbeat", move || {
            while !stopping.wait(control().worker_poll_interval_seconds) {
                if let Err(error) = worker.queue.set_setting(
                    "worker",
                    json!({"running": true, "heartbeat": worker.time()}),
                ) {
                    tracing::error!(
                        "Could not refresh browser worker heartbeat ({})",
                        storage_failure_reason(&error)
                            .map(str::to_owned)
                            .unwrap_or_else(|| error.type_name())
                    );
                }
            }
        })
    }

    fn source_pollers(&self, stopping: Arc<Event>) -> Vec<JoinHandle<()>> {
        // Starts set: on startup the worker queues profiles it listed while stopping.
        self.queue.retrieval_finished.set();
        let mut threads = Vec::new();
        let (queue, bridge, stop) = (self.queue.clone(), self.bridge.clone(), stopping.clone());
        threads.push(spawn_named("instagram-browser-lightpanda", move || {
            crate::lightpanda::lane::run(queue, bridge, stop);
        }));
        let worker = self.clone();
        let stop = stopping.clone();
        threads.push(spawn_named("instagram-browser-profile-queue", move || {
            // Collect whenever a retrieval finishes; one that finishes during a
            // collection runs it again. The timeout only lets shutdown be noticed.
            while !stop.is_set() {
                if !worker
                    .queue
                    .retrieval_finished
                    .wait(control().worker_poll_interval_seconds)
                {
                    continue;
                }
                worker.queue.retrieval_finished.clear();
                worker.collect("profile_queue_status", || worker.queue_profiles());
            }
        }));
        let worker = self.clone();
        let stop = stopping.clone();
        threads.push(spawn_named(
            "instagram-browser-diagnostics_status",
            move || {
                while !stop.is_set() {
                    worker.collect("diagnostics_status", || worker.publish_diagnostics(&stop));
                    stop.wait(control().source_poll_interval_seconds);
                }
            },
        ));
        let worker = self.clone();
        let stop = stopping;
        threads.push(spawn_named("instagram-browser-source_status", move || {
            while !stop.is_set() {
                worker.collect("source_status", || worker.collect_carousels());
                stop.wait(control().source_poll_interval_seconds);
            }
        }));
        threads
    }

    fn database(&self) -> anyhow::Result<&BlockingPool> {
        self.db
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("The browser worker has no database connection"))
    }

    fn collect_carousels(&self) -> anyhow::Result<()> {
        let result = (self.seams.collect_carousels)(self)?;
        self.queue.set_setting(
            "source_status",
            json!({"checked_at": self.time(), "result": result}),
        )?;
        Ok(())
    }

    fn queue_profiles(&self) -> anyhow::Result<()> {
        let db = self.database()?;
        let result = profile_retrieval::queue_retrieved_profiles(&self.queue, &|urls, school| {
            let (urls, school) = (urls.to_vec(), school.to_owned());
            db.run(|pool| async move {
                crate::ingestion::items::queue_instagram(&pool, &urls, &school).await
            })
        })?;
        let mut status = json!({"checked_at": self.time()});
        if let (Some(status), Value::Object(result)) = (status.as_object_mut(), result) {
            status.extend(result);
        }
        self.queue.set_setting("profile_queue_status", status)?;
        Ok(())
    }

    fn publish_diagnostics(&self, stopping: &Event) -> anyhow::Result<()> {
        let db = self.database()?;
        self.queue.publish_diagnostics(
            || stopping.is_set(),
            |event| {
                let event = event.clone();
                db.run(|pool| async move {
                    Ok::<_, anyhow::Error>(
                        crate::automate_logs::create_automate_log(&pool, &event).await,
                    )
                })
                .unwrap_or(false)
            },
        )?;
        Ok(())
    }

    /// Run one source collection, recording its failure without stopping the worker.
    fn collect(&self, status_key: &str, collect: impl FnOnce() -> anyhow::Result<()>) {
        let Err(error) = collect() else {
            return;
        };
        let error = error_kind(&error);
        if let Err(storage_error) = self.queue.set_setting(
            status_key,
            json!({"checked_at": self.time(), "error": error}),
        ) {
            tracing::error!(
                "Could not record browser source collection failure: {}",
                storage_failure_reason(&storage_error)
                    .map(str::to_owned)
                    .unwrap_or_else(|| storage_error.type_name())
            );
        }
        tracing::error!("Browser source {status_key} failed ({error})");
    }
}

/// A collection failure as the status records it: a storage reason or the error's kind.
fn error_kind(error: &anyhow::Error) -> String {
    if let Some(browser) = error.downcast_ref::<BrowserError>() {
        return storage_failure_reason(browser)
            .map(str::to_owned)
            .unwrap_or_else(|| browser.type_name());
    }
    match error.downcast_ref::<sqlx::Error>() {
        Some(sqlx::Error::Database(_)) => "APIError".to_owned(),
        Some(_) => "ConnectError".to_owned(),
        None => "RuntimeError".to_owned(),
    }
}

fn spawn_named(name: &str, body: impl FnOnce() + Send + 'static) -> JoinHandle<()> {
    let controls = InheritedControls::capture();
    std::thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || {
            controls.install();
            body();
        })
        .expect("thread spawns")
}

/// Join a background thread unless the shutdown deadline passes first.
fn join_until(thread: JoinHandle<()>, bridge: &Bridge, deadline: f64) {
    while !thread.is_finished() && bridge.monotonic() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if thread.is_finished() {
        let _ = thread.join();
    }
}

/// Execute one job on `session`, settling the tab after every failure.
pub fn execute_job(
    job: &BrowserJob,
    session: &mut BrowserInstagramSession,
    on_rate_limit: Option<&dyn Fn(&BrowserError)>,
) -> BrowserResult<Value> {
    let text = |key: &str| job.payload.get(key).map(pyjson::str).unwrap_or_default();
    let optional = |key: &str| job.payload.get(key).and_then(Value::as_str);
    let executed = match job.kind.as_str() {
        "digest" => browser_digest::resolve(
            session,
            &job.recipient_id,
            &job.account_username,
            &text("cache_ent_id"),
        )
        .map(|resolution| resolution.to_value()),
        "retrieval" => browser_ingestion::retrieve(
            session,
            &text("url"),
            job.payload
                .get("cutoff_days")
                .and_then(Value::as_i64)
                .unwrap_or(1),
        ),
        "following" => browser_following::read_page(
            session,
            &text("username"),
            optional("user_id"),
            optional("max_id"),
        ),
        _ => browser_engagement::engage_post(
            session,
            &job.recipient_id,
            &job.account_username,
            &text("post_url"),
            job.dry_run(),
        ),
    };
    let error = match executed {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };
    let rate_error = match &error {
        BrowserError::ReadCleanupPending {
            operation_error, ..
        } => operation_error.as_deref(),
        other => Some(other),
    };
    if let (Some(rate_error), Some(on_rate_limit)) = (rate_error, on_rate_limit)
        && rate_error.is(SessionKind::RateLimited)
    {
        on_rate_limit(rate_error);
    }
    let error = if error.is_session() {
        deferred_read_cleanup(job, session, &error, None).unwrap_or(error)
    } else {
        error
    };
    // Query returns only after its own settlement proof. Native engagement starts by
    // settling the previous request and creates no worker fetch. Keep exact-tab cleanup
    // for every failure, including navigation and clicks.
    settle_job(job, session, &error)?;
    Err(error)
}

fn deferred_read_cleanup(
    job: &BrowserJob,
    session: &mut BrowserInstagramSession,
    error: &BrowserError,
    operation_error: Option<&BrowserError>,
) -> Option<BrowserError> {
    if !read_only(job)
        || !session.is_secondary_read_tab()
        || !error.to_string().contains(CANCELLATION_UNCONFIRMED)
    {
        return None;
    }
    if let Some(operation_error) = operation_error.filter(|error| error.is_cleanup_pending()) {
        return Some(operation_error.clone());
    }
    if error.is_cleanup_pending() {
        return Some(error.clone());
    }
    Some(BrowserError::ReadCleanupPending {
        message: error.to_string(),
        operation_error: operation_error.cloned().map(Box::new),
        completed_payload: None,
    })
}

/// Keep uncertain actions paused; defer secondary proof until other reads drain.
fn settle_job(
    job: &BrowserJob,
    session: &mut BrowserInstagramSession,
    operation_error: &BrowserError,
) -> BrowserResult<()> {
    let settled = match session.cancel_pending_request() {
        Ok(()) => return Ok(()),
        Err(error) if error.is_session() => {
            deferred_read_cleanup(job, session, &error, Some(operation_error)).unwrap_or(error)
        }
        Err(error) => error,
    };
    if settled.is_cleanup_pending() {
        return Err(settled);
    }
    if operation_error.is_interrupted() {
        return Err(BrowserError::Interrupted);
    }
    Err(settled)
}

/// Python's `_process_batch` and the closures it shares with its executor threads.
struct Batch {
    worker: Worker,
    jobs: Vec<BrowserJob>,
    allow_engagement: bool,
    shared: Arc<BatchShared>,
    unfinished: HashSet<String>,
    pool_retries: Vec<(BrowserJob, String)>,
    interruption: Option<BrowserError>,
    futures: Vec<Future>,
    next_future: usize,
    completions: mpsc::Receiver<(usize, BrowserResult<Value>)>,
    completion_sender: mpsc::Sender<(usize, BrowserResult<Value>)>,
}

#[derive(Default)]
struct BatchShared {
    pool_changed: Event,
    cleanup_pending: Mutex<Vec<PendingCleanup>>,
    rate_limit_deferred: Mutex<HashSet<String>>,
    storage_error: Mutex<Option<BrowserError>>,
}

/// One submitted job: its thread and, once it finished, its outcome.
struct Future {
    id: usize,
    job: BrowserJob,
    session: Arc<Mutex<BrowserInstagramSession>>,
    thread: Option<JoinHandle<()>>,
    outcome: Option<BrowserResult<Value>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl BatchShared {
    fn defer_storage(&self, queue: &BrowserJobQueue, error: BrowserError) {
        let mut stored = lock(&self.storage_error);
        if stored.is_none() {
            tracing::warn!(
                "Browser batch waiting for storage: {}",
                storage_failure_reason(&error).unwrap_or_default()
            );
            *stored = Some(error);
        }
        queue.set_storage_unavailable(true);
        self.pool_changed.set();
    }

    /// Run a queue write; a storage failure defers the batch instead of raising.
    fn persist<T>(
        &self,
        queue: &BrowserJobQueue,
        operation: impl FnOnce() -> BrowserResult<T>,
    ) -> BrowserResult<Option<T>> {
        match operation() {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.is_storage() => {
                self.defer_storage(queue, error);
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    fn defer_rate_limit(&self, queue: &BrowserJobQueue, job: &BrowserJob, error: &BrowserError) {
        // Announce the hold before failed-operation cleanup can block healthy completions.
        self.pool_changed.set();
        let mut deferred = lock(&self.rate_limit_deferred);
        if !deferred.contains(&job.id) {
            let _ = self.persist(queue, || {
                queue.defer_for_rate_limit(Some(job), &error.to_string())
            });
            deferred.insert(job.id.clone());
        }
    }
}

impl Batch {
    fn new(worker: Worker, jobs: Vec<BrowserJob>, allow_engagement: bool) -> Self {
        let (completion_sender, completions) = mpsc::channel();
        Self {
            unfinished: jobs.iter().map(|job| job.id.clone()).collect(),
            worker,
            jobs,
            allow_engagement,
            shared: Arc::new(BatchShared::default()),
            pool_retries: Vec::new(),
            interruption: None,
            futures: Vec::new(),
            next_future: 0,
            completions,
            completion_sender,
        }
    }

    fn queue(&self) -> &BrowserJobQueue {
        &self.worker.queue
    }

    fn persist<T>(&self, operation: impl FnOnce() -> BrowserResult<T>) -> BrowserResult<Option<T>> {
        self.shared.persist(self.queue(), operation)
    }

    fn cleanup_pending_contains(&self, job_id: &str) -> bool {
        lock(&self.shared.cleanup_pending)
            .iter()
            .any(|(job, _, _)| job.id == job_id)
    }

    fn run(mut self) -> BrowserResult<()> {
        let outcome = self.prepare_and_execute();
        // Exiting the executor drains every active tab.
        self.drain();
        let raised = match outcome {
            Ok(()) => Ok(()),
            Err(BrowserError::Interrupted) => {
                self.interruption = Some(BrowserError::Interrupted);
                self.persist(|| {
                    self.queue()
                        .set_setting("paused", Value::from(INTERRUPTED_PAUSE))
                })
                .and_then(|_| {
                    for job in self.jobs.clone() {
                        if self.unfinished.contains(&job.id)
                            && !self.cleanup_pending_contains(&job.id)
                        {
                            self.persist(|| {
                                self.queue().finish(&job, Finish::error(STOPPED_DURING_JOB))
                            })?;
                        }
                    }
                    Ok(())
                })
            }
            Err(error) if error.is_storage() => {
                self.shared.defer_storage(self.queue(), error);
                Ok(())
            }
            Err(error) => (|| {
                for job in self.jobs.clone() {
                    if self.unfinished.contains(&job.id) && !self.cleanup_pending_contains(&job.id)
                    {
                        self.failed(&job, &error)?;
                    }
                }
                Ok(())
            })(),
        };
        // As in Python's `finally`, a failure while finishing replaces the batch's own.
        let finalized = self.finalize();
        finalized.and(raised)
    }

    /// Settle the tabs and verify the account; log in once first when Brave was logged
    /// out or misses the account, as found before any request.
    fn prepare(
        &self,
        first: &BrowserJob,
        capacity: usize,
    ) -> BrowserResult<(Vec<BrowserInstagramSession>, String)> {
        let worker = &self.worker;
        match worker.tab_pool().prepare(first, capacity) {
            Ok(prepared) => Ok(prepared),
            Err(error) if error.is_session() => {
                // A logout or a missing account found before any request: log in, then
                // run the batch.
                let time = || worker.time();
                let recovered = if is_logout(&Value::from(error.to_string())) {
                    worker.attempt_login_recovery(&time)?
                } else if error.to_string() == ACCOUNT_UNAVAILABLE {
                    let added = worker.attempt_account_login(&first.account_username, &time)?;
                    if !added {
                        // Reruns of its failed notifications wait until it may log in.
                        worker
                            .queue
                            .mark_account_missing(&first.account_username, time())?;
                    }
                    added
                } else {
                    false
                };
                if !recovered {
                    return Err(error);
                }
                worker.tab_pool().prepare(first, capacity)
            }
            Err(error) => Err(error),
        }
    }

    fn prepare_and_execute(&mut self) -> BrowserResult<()> {
        let first = self.jobs[0].clone();
        let capacity = if first.kind == "retrieval" {
            control().parallel_tabs
        } else {
            self.jobs.len()
        };
        let worker = self.worker.clone();
        // Only preparation (and any login it needs) is bounded by one job's deadline; a
        // retrieval stream that keeps refilling its tabs may run longer.
        let prepared = with_job_deadline(&worker.bridge, control().job_timeout_seconds, || {
            self.prepare(&first, capacity)
        })?;
        let (sessions, username) = prepared;
        let mut sessions: Vec<Arc<Mutex<BrowserInstagramSession>>> = sessions
            .into_iter()
            .map(|session| Arc::new(Mutex::new(session)))
            .collect();
        if sessions.len() < self.jobs.len() {
            return Err(BrowserError::Value(
                "zip() argument 2 is shorter than argument 1".to_owned(),
            ));
        }
        // Keep slots busy until the queue empties, a digest arrives, or work is paused.
        let mut idle_sessions = sessions.split_off(self.jobs.len());
        for (job, session) in self.jobs.clone().into_iter().zip(sessions) {
            self.submit(job, session, &username);
        }
        while !self.futures.is_empty() {
            if first.kind == "retrieval" {
                while !idle_sessions.is_empty() && !self.shared.pool_changed.is_set() {
                    let replacements =
                        self.queue()
                            .claim_companions(&first, 1, self.allow_engagement)?;
                    let Some(replacement) = replacements.into_iter().next() else {
                        break;
                    };
                    let session = idle_sessions.pop().expect("an idle session is available");
                    self.jobs.push(replacement.clone());
                    self.unfinished.insert(replacement.id.clone());
                    self.queue()
                        .record_diagnostic("running", Some(&replacement), None);
                    if self.queue().is_storage_unavailable() {
                        self.shared.pool_changed.set();
                        break;
                    }
                    self.submit(replacement, session, &username);
                }
            }
            for future in self.wait_first_completed()? {
                let Future {
                    job,
                    session,
                    outcome,
                    ..
                } = future;
                let outcome = outcome
                    .expect("a completed future has an outcome")
                    .and_then(|result| self.queue().finish(&job, Finish::result(result)));
                match outcome {
                    Ok(()) => {
                        self.unfinished.remove(&job.id);
                    }
                    Err(error) if error.is_cleanup_pending() => {
                        self.persist(|| {
                            self.queue()
                                .set_setting("retrieval_pool_account", Value::Null)
                        })?;
                        self.unfinished.remove(&job.id);
                    }
                    Err(BrowserError::Interrupted) => return Err(BrowserError::Interrupted),
                    Err(error) => self.failed(&job, &error)?,
                }
                if let Some(finished) = self.persist(|| self.queue().get(&job.id))?.flatten()
                    && finished.state != "running"
                {
                    self.queue()
                        .record_diagnostic(&finished.state, Some(&finished), None);
                }
                if first.kind != "retrieval" || self.shared.pool_changed.is_set() {
                    continue;
                }
                let replacements =
                    self.queue()
                        .claim_companions(&first, 1, self.allow_engagement)?;
                let Some(replacement) = replacements.into_iter().next() else {
                    idle_sessions.push(session);
                    continue;
                };
                self.jobs.push(replacement.clone());
                self.unfinished.insert(replacement.id.clone());
                self.queue()
                    .record_diagnostic("running", Some(&replacement), None);
                if self.queue().is_storage_unavailable() {
                    self.shared.pool_changed.set();
                    continue;
                }
                self.submit(replacement, session, &username);
            }
        }
        Ok(())
    }

    fn submit(
        &mut self,
        job: BrowserJob,
        session: Arc<Mutex<BrowserInstagramSession>>,
        username: &str,
    ) {
        let id = self.next_future;
        self.next_future += 1;
        let worker = self.worker.clone();
        let shared = self.shared.clone();
        let sender = self.completion_sender.clone();
        let (thread_job, thread_session, username) =
            (job.clone(), session.clone(), username.to_owned());
        let controls = InheritedControls::capture();
        let thread = std::thread::spawn(move || {
            controls.install();
            let mut session = lock(&thread_session);
            let outcome = execute_in_batch(
                &worker,
                &shared,
                &thread_job,
                &thread_session,
                &mut session,
                &username,
            );
            drop(session);
            let _ = sender.send((id, outcome));
        });
        self.futures.push(Future {
            id,
            job,
            session,
            thread: Some(thread),
            outcome: None,
        });
    }

    /// `wait(futures, timeout=1, return_when=FIRST_COMPLETED)`: the futures that have
    /// finished, removed from the pending set. Checks this thread's deadline and stop
    /// requests between waits, as Python's signals interrupted its wait.
    fn wait_first_completed(&mut self) -> BrowserResult<Vec<Future>> {
        self.worker.bridge.check()?;
        if let Ok(completion) = self
            .completions
            .recv_timeout(std::time::Duration::from_secs(1))
        {
            self.record_completion(completion);
            while let Ok(completion) = self.completions.try_recv() {
                self.record_completion(completion);
            }
        }
        let mut completed = Vec::new();
        let mut pending = Vec::new();
        for mut future in std::mem::take(&mut self.futures) {
            if future.outcome.is_some() {
                if let Some(thread) = future.thread.take() {
                    let _ = thread.join();
                }
                completed.push(future);
            } else {
                pending.push(future);
            }
        }
        self.futures = pending;
        Ok(completed)
    }

    fn record_completion(&mut self, (id, outcome): (usize, BrowserResult<Value>)) {
        if let Some(future) = self.futures.iter_mut().find(|future| future.id == id) {
            future.outcome = Some(outcome);
        }
    }

    /// Wait for every submitted job's thread, as leaving the executor did.
    fn drain(&mut self) {
        while self.futures.iter().any(|future| future.outcome.is_none()) {
            match self.completions.recv() {
                Ok(completion) => self.record_completion(completion),
                Err(_) => break,
            }
        }
        for future in &mut self.futures {
            if let Some(thread) = future.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn failed(&mut self, job: &BrowserJob, error: &BrowserError) -> BrowserResult<()> {
        let queue = self.worker.queue.clone();
        if error.is_storage() {
            self.shared.defer_storage(&queue, error.clone());
            return Ok(());
        }
        let rate_limited = error.is(SessionKind::RateLimited);
        if rate_limited {
            self.shared.defer_rate_limit(&queue, job, error);
        }
        let pool_lost =
            error.is(SessionKind::AccountChanged) || error.is(SessionKind::TabUnavailable);
        if pool_lost {
            self.shared.pool_changed.set();
            self.persist(|| queue.set_setting("retrieval_pool_account", Value::Null))?;
        }
        let message = if error.is_session() || error.is_timeout() {
            let message = error.to_string();
            if requires_human_recovery(error, job) {
                self.persist(|| queue.set_setting("paused", Value::from(message.clone())))?;
            }
            message
        } else {
            let message = failure_reason(error, "Browser job");
            tracing::error!("Browser job {} failed: {message}", job.id);
            self.persist(|| queue.set_setting("paused", Value::from(message.clone())))?;
            message
        };
        let retryable = read_only(job)
            && (rate_limited || job.attempts < control().ingestion_retry_limit)
            && (rate_limited
                || !self
                    .persist(|| queue.setting_or("paused", Value::Bool(false)))?
                    .is_some_and(|paused| truthy(&paused)))
            && (pool_lost
                || rate_limited
                || error.is(SessionKind::AutomationTransient)
                || error.is(SessionKind::PageUnavailable)
                || error.is_timeout());
        if pool_lost && retryable {
            // Keep the caller waiting until all requests have settled.
            self.pool_retries.push((job.clone(), message));
        } else {
            self.persist(|| {
                queue.finish(
                    job,
                    Finish {
                        result: None,
                        error: Some(message),
                        requeue: retryable,
                        refund_rate_limit: retryable && rate_limited,
                    },
                )
            })?;
        }
        self.unfinished.remove(&job.id);
        Ok(())
    }

    /// Python's `finally`: observe failures that a queue write interrupted, settle the
    /// deferred secondary reads, then requeue jobs that waited for the pool.
    fn finalize(&mut self) -> BrowserResult<()> {
        let queue = self.worker.queue.clone();
        for future in std::mem::take(&mut self.futures) {
            match future.outcome.expect("drained futures have outcomes") {
                Err(error) if error.is_cleanup_pending() => {}
                Err(BrowserError::Interrupted) => {
                    self.interruption.get_or_insert(BrowserError::Interrupted);
                }
                Err(error) => self.failed(&future.job, &error)?,
                Ok(result) => {
                    self.persist(|| queue.finish(&future.job, Finish::result(result)))?;
                }
            }
        }
        // Every future and its cancellation has settled before any retry can switch accounts.
        let pending: Vec<_> = lock(&self.shared.cleanup_pending).clone();
        for (job, session, pending_error) in pending {
            let operation_error = match &pending_error {
                BrowserError::ReadCleanupPending {
                    operation_error, ..
                } => operation_error.as_deref().cloned(),
                _ => None,
            };
            let mut recovered: Option<BrowserError> = None;
            for _ in 0..control().bridge_retry_limit {
                let mut session = lock(&session);
                match session.cancel_pending_request() {
                    Ok(()) => {
                        recovered = Some(operation_error.clone().unwrap_or_else(|| {
                            BrowserError::page_unavailable(
                                "Secondary read cleanup recovered after draining active jobs",
                            )
                        }));
                        break;
                    }
                    Err(BrowserError::Interrupted) => {
                        self.interruption.get_or_insert(BrowserError::Interrupted);
                        self.persist(|| {
                            queue.set_setting("paused", Value::from(INTERRUPTED_PAUSE))
                        })?;
                    }
                    Err(cleanup_error) if cleanup_error.is_session() => {
                        recovered = Some(match session.retire_unresponsive_read_tab() {
                            Ok(()) => operation_error.clone().unwrap_or_else(|| {
                                BrowserError::tab_unavailable(
                                    "The unresponsive secondary Instagram tab was closed",
                                )
                            }),
                            Err(BrowserError::Interrupted) => {
                                self.interruption.get_or_insert(BrowserError::Interrupted);
                                self.persist(|| {
                                    queue.set_setting("paused", Value::from(INTERRUPTED_PAUSE))
                                })?;
                                continue;
                            }
                            Err(_) => cleanup_error,
                        });
                        break;
                    }
                    Err(cleanup_error) => {
                        recovered = Some(cleanup_error);
                        break;
                    }
                }
            }
            let mut recovered = recovered.unwrap_or_else(|| {
                BrowserError::session(
                    "Instagram browser request cancellation could not be confirmed after interruption",
                )
            });
            if recovered.is_interrupted() {
                self.interruption.get_or_insert(BrowserError::Interrupted);
                self.persist(|| queue.set_setting("paused", Value::from(INTERRUPTED_PAUSE)))?;
                recovered = BrowserError::session(STOPPED_DURING_JOB);
            }
            self.failed(&job, &recovered)?;
            if let Some(finished) = self.persist(|| queue.get(&job.id))?.flatten()
                && finished.state != "running"
            {
                queue.record_diagnostic(&finished.state, Some(&finished), None);
            }
        }
        for (job, error) in std::mem::take(&mut self.pool_retries) {
            let paused = self
                .persist(|| queue.setting_or("paused", Value::Bool(false)))?
                .is_some_and(|paused| truthy(&paused));
            self.persist(|| {
                queue.finish(
                    &job,
                    Finish {
                        result: None,
                        error: Some(error.clone()),
                        requeue: !paused,
                        refund_rate_limit: false,
                    },
                )
            })?;
            if let Some(finished) = self.persist(|| queue.get(&job.id))?.flatten() {
                queue.record_diagnostic(&finished.state, Some(&finished), None);
            }
        }
        if let Some(interruption) = self.interruption.take() {
            return Err(interruption);
        }
        if let Some(storage_error) = lock(&self.shared.storage_error).take() {
            return Err(storage_error);
        }
        Ok(())
    }
}

/// Python's `execute`, run on one batch thread for one job and its secondary tab.
fn execute_in_batch(
    worker: &Worker,
    shared: &Arc<BatchShared>,
    job: &BrowserJob,
    session_handle: &Arc<Mutex<BrowserInstagramSession>>,
    session: &mut BrowserInstagramSession,
    username: &str,
) -> BrowserResult<Value> {
    let queue = &worker.queue;
    session.reset_job_deadline(control().job_timeout_seconds);
    let outcome = (|| {
        if job.kind != "retrieval" {
            let ready = session.poll_until(|session| {
                let path = session.current_page_path(true)?;
                let active = session.current_account_username()?;
                let Some(active) = active.filter(|_| !path.starts_with("/accounts/")) else {
                    return Ok(false);
                };
                if active != username {
                    session.bridge.sleep(control().account_transition_grace_seconds)?;
                    let confirmed = session.current_account_username()?;
                    let Some(confirmed) = confirmed.filter(|confirmed| confirmed != username) else {
                        return Ok(false);
                    };
                    shared.pool_changed.set();
                    return Err(BrowserError::account_changed(format!(
                        "Instagram browser account changed during parallel work: expected {username}, found {confirmed}"
                    )));
                }
                Ok(true)
            });
            if let Err(error) = ready {
                if error.is(SessionKind::RateLimited) {
                    shared.defer_rate_limit(queue, job, &error);
                }
                settle_job(job, session, &error)?;
                return Err(error);
            }
        }
        // Successful operations settle themselves; execute_job covers every failed exit.
        let on_rate_limit = |error: &BrowserError| shared.defer_rate_limit(queue, job, error);
        let result = (worker.seams.execute_job)(job, session, Some(&on_rate_limit))?;
        if (job.kind == "retrieval" || job.kind == "following")
            && result.get("account_username").and_then(Value::as_str) != Some(username)
        {
            return Err(BrowserError::account_changed(
                "Instagram read account does not match the verified primary account",
            ));
        }
        Ok(result)
    })();
    match outcome {
        Err(error) if error.is_cleanup_pending() => {
            {
                let mut pending = lock(&shared.cleanup_pending);
                pending.retain(|(pending_job, _, _)| pending_job.id != job.id);
                pending.push((job.clone(), session_handle.clone(), error.clone()));
            }
            shared.pool_changed.set();
            if let BrowserError::ReadCleanupPending {
                operation_error: Some(operation_error),
                ..
            } = &error
                && operation_error.is(SessionKind::RateLimited)
            {
                shared.defer_rate_limit(queue, job, operation_error);
            }
            Err(error)
        }
        Err(error)
            if error.is(SessionKind::AccountChanged)
                || error.is(SessionKind::TabUnavailable)
                || error.is(SessionKind::RateLimited) =>
        {
            shared.pool_changed.set();
            Err(error)
        }
        other => other,
    }
}

/// Install the stop handlers: SIGTERM (launchd) and Ctrl-C stop the worker between steps.
pub fn handle_stop_signals(terminate: Arc<Event>) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    let Ok(mut signals) = signal_hook::iterator::Signals::new([SIGTERM, SIGINT]) else {
        return;
    };
    std::thread::spawn(move || {
        if signals.forever().next().is_some() {
            request_stop();
            terminate.set();
        }
    });
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/browser_worker.rs"]
mod python_tests;

/// Replays of the Python worker's recorded Brave traffic.
#[cfg(test)]
#[path = "tests/parity.rs"]
mod parity_tests;
