//! The worker's Lightpanda lane: digests and Following reads in each school account's
//! own Lightpanda session, beside Brave, in a thread of the `wat2do-browser` worker.
//!
//! Every account whose jar holds a login (and is neither paused for a person nor
//! excluded) is served:
//! - with `digest_engine` "lightpanda", its digests are read in its own session;
//! - every served account reads Following lists, each at its own pace, so the crawl's
//!   reads spread over all of them.
//!
//! The lane says which accounts it serves in the queue (`lightpanda_lane`), and Brave
//! reads everything else (`browser_queue_lightpanda`). An account is dropped from the
//! lane, handing its digests back to Brave, while it is held after a 429 or refusal,
//! after any digest it could not read, and once Instagram ends its login (its jar
//! then forgets the login until the ramp logs it in again). Brave's own pauses and
//! holds never stop the lane, and Brave's recovery leaves the lane's running jobs to
//! it.
//!
//! A digest gets `lane_digest_timeout_seconds` in all, opening its session included,
//! and a Following read `lane_following_timeout_seconds`, so a digest always meets the
//! workflow's deadline (Brave also takes one the lane leaves waiting).
//!
//! At most `max_sessions` Lightpanda processes run at once on the Mac. A session stays
//! open while its account has work and closes after `session_idle_seconds` without a
//! job, or once `session_max_seconds` old; a waiting digest closes the longest-idle
//! session to make room. At its turn ([`ramp::take_turn`]) the lane also logs one more
//! account in ([`super::ramp`]).

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::task::{Id, JoinError, JoinSet};

use super::Lightpanda;
use super::browser::Browser;
use super::login::{self, LoginResult};
use super::{digest, following, ramp};
use crate::controlbox::{
    DigestEngine, INSTAGRAM_DIGEST, INSTAGRAM_LIGHTPANDA as CONTROL, instagram_browser,
};
use crate::host::Event;
use crate::instagram_notifications::browser_queue::{
    BrowserJob, BrowserJobQueue, Finish, LanePending, LaneRead,
};
use crate::instagram_notifications::browser_session::Bridge;
use crate::instagram_notifications::errors::{BrowserError, BrowserResult, SessionKind};
use crate::pyjson;

/// How often the lane looks for work.
const TICK: Duration = Duration::from_millis(500);
/// How often it reads the jars and the accounts' pauses again, and says what it serves.
const REFRESH: Duration = Duration::from_secs(5);
/// How long it waits before trying a missing Lightpanda again.
const INSTALL_RETRY: Duration = Duration::from_secs(600);
/// Shutdown, inside the worker's 30 s stop: the reads under way get this long to
/// finish, and closing every session (which saves its jar) must end by the second.
const SHUTDOWN_READS: Duration = Duration::from_secs(8);
const SHUTDOWN_ALL: Duration = Duration::from_secs(24);
/// How long a failed read waits to learn whether its session is still logged in.
const SESSION_CHECK: Duration = Duration::from_secs(5);

/// One account's open Lightpanda.
struct Session {
    browser: Browser,
    /// The Instagram user it is logged in as.
    user_id: String,
    opened: Instant,
    used: Instant,
}

/// A job the lane ran, and the session it ran in when that is worth keeping.
struct Ran {
    account: String,
    job: BrowserJob,
    outcome: BrowserResult<Value>,
    session: Option<Session>,
    /// Instagram ended the account's login.
    logged_out: bool,
}

/// What a task returns.
enum Task {
    Job(Box<Ran>),
    Ramp,
    Closed,
}

/// What a task is doing, by its ID, so one that panics still frees what it held.
enum Doing {
    Job {
        account: String,
        job: Box<BrowserJob>,
    },
    Ramp,
    Close {
        account: String,
    },
}

/// Run the lane until `stopping` is set; the worker calls this in its own thread.
pub fn run(queue: Arc<BrowserJobQueue>, bridge: Arc<Bridge>, stopping: Arc<Event>) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::error!("The Lightpanda lane could not start: {error}");
            return;
        }
    };
    let local = tokio::task::LocalSet::new();
    local.block_on(&runtime, async move {
        let jars = super::jars_in(&queue.state_directory);
        let Some(lightpanda) = installed(&jars, &stopping).await else {
            return;
        };
        Lane::new(Rc::new(lightpanda), queue, bridge, stopping)
            .run()
            .await;
    });
}

/// The pinned Lightpanda with the jars beside the worker's queue, waiting until both
/// are there (`wat2do-lightpanda install` and the first login make them); None once
/// stopping.
async fn installed(jars: &Path, stopping: &Event) -> Option<Lightpanda> {
    loop {
        if jars.is_dir() {
            match Lightpanda::installed_with_jars(jars.to_path_buf()).await {
                Ok(lightpanda) => return Some(lightpanda),
                Err(error) => tracing::warn!("The Lightpanda lane waits for Lightpanda: {error:#}"),
            }
        }
        let deadline = Instant::now() + INSTALL_RETRY;
        while Instant::now() < deadline {
            if stopping.is_set() {
                return None;
            }
            tokio::time::sleep(TICK).await;
        }
    }
}

struct Lane {
    lightpanda: Rc<Lightpanda>,
    queue: Arc<BrowserJobQueue>,
    bridge: Arc<Bridge>,
    stopping: Arc<Event>,
    /// The accounts logged in, neither paused nor excluded, by name.
    accounts: Vec<String>,
    /// Those of them not held: the accounts the lane serves.
    served: Vec<String>,
    /// Open sessions waiting for work.
    idle: HashMap<String, Session>,
    /// Accounts with a job or the ramp's login under way.
    busy: HashSet<String>,
    /// Accounts whose session is closing: none is opened for them until it has, since
    /// it still holds their lock.
    closing: HashSet<String>,
    tasks: JoinSet<Task>,
    doing: HashMap<Id, Doing>,
    /// Sessions open, opening or closing, and the ramp's login: each holds one of the
    /// `max_sessions` places.
    places: usize,
    /// When each account last ran a job, so the reads go round the accounts.
    last_used: HashMap<String, Instant>,
    refreshed: Option<Instant>,
}

impl Lane {
    fn new(
        lightpanda: Rc<Lightpanda>,
        queue: Arc<BrowserJobQueue>,
        bridge: Arc<Bridge>,
        stopping: Arc<Event>,
    ) -> Self {
        Self {
            lightpanda,
            queue,
            bridge,
            stopping,
            accounts: Vec::new(),
            served: Vec::new(),
            idle: HashMap::new(),
            busy: HashSet::new(),
            closing: HashSet::new(),
            tasks: JoinSet::new(),
            doing: HashMap::new(),
            places: 0,
            last_used: HashMap::new(),
            refreshed: None,
        }
    }

    async fn run(mut self) {
        while !self.stopping.is_set() {
            if let Err(error) = self.step() {
                tracing::error!("The Lightpanda lane failed a step: {error}");
            }
            let finished = tokio::select! {
                Some(done) = self.tasks.join_next_with_id() => Some(done),
                () = tokio::time::sleep(TICK) => None,
            };
            if let Some(done) = finished {
                self.settle(done);
            }
        }
        self.shut_down().await;
    }

    fn step(&mut self) -> BrowserResult<()> {
        if self.refreshed.is_none_or(|at| at.elapsed() >= REFRESH) {
            self.refresh()?;
            self.maybe_ramp();
        }
        self.close_idle();
        self.claim()
    }

    /// Read which accounts are logged in and free, and say what the lane serves.
    fn refresh(&mut self) -> BrowserResult<()> {
        let logged_in = self
            .lightpanda
            .logged_in_accounts()
            .unwrap_or_else(|error| {
                tracing::error!("The Lightpanda jars could not be read: {error:#}");
                Vec::new()
            });
        let mut accounts = Vec::new();
        for account in logged_in {
            let paused = login::paused(&self.queue, &account)
                .map_err(|error| BrowserError::other("RuntimeError", format!("{error:#}")))?;
            if paused.is_none() && !self.queue.account_excluded(&account)? {
                accounts.push(account);
            }
        }
        self.accounts = accounts;
        self.publish()
    }

    /// Say which accounts the lane serves: those not held.
    fn publish(&mut self) -> BrowserResult<()> {
        let now = self.bridge.time();
        let mut served = Vec::new();
        for account in &self.accounts {
            if self.queue.lightpanda_pace(account)?.held_until <= now {
                served.push(account.clone());
            }
        }
        let digests = if reads_digests() {
            served.clone()
        } else {
            Vec::new()
        };
        self.queue
            .set_lightpanda_lane(&digests, &served, self.places)?;
        self.served = served;
        self.refreshed = Some(Instant::now());
        Ok(())
    }

    /// Close sessions no job has used for a while, that are too old, or whose account
    /// the lane no longer serves.
    fn close_idle(&mut self) {
        let idle = Duration::from_secs_f64(CONTROL.session_idle_seconds);
        let oldest = Duration::from_secs_f64(CONTROL.session_max_seconds);
        let stale: Vec<String> = self
            .idle
            .iter()
            .filter(|(account, session)| {
                session.used.elapsed() >= idle
                    || session.opened.elapsed() >= oldest
                    || !self.accounts.contains(account)
            })
            .map(|(account, _)| account.clone())
            .collect();
        for account in stale {
            self.close(&account, false);
        }
    }

    /// Give each free account the next job it may run, sessions already open first.
    /// Only an account with work waiting takes the queue's write lock to claim it.
    fn claim(&mut self) -> BrowserResult<()> {
        let order = self.claim_order();
        if order.is_empty() {
            return Ok(());
        }
        let pending = self.queue.lightpanda_pending()?;
        if pending == LanePending::default() {
            return Ok(());
        }
        for account in order {
            let digest = reads_digests() && pending.digests.contains(&account);
            let open = self.idle.contains_key(&account);
            if !open && self.places >= CONTROL.max_sessions {
                // Full: only a waiting digest makes room, by closing the longest-idle
                // session once no other is closing.
                if digest && self.closing.is_empty() {
                    self.close_longest_idle();
                }
                continue;
            }
            if !(digest || pending.following) {
                continue;
            }
            let Some(job) = self
                .queue
                .claim_lightpanda(&account, digest, pending.following)?
            else {
                continue;
            };
            self.queue.record_diagnostic("running", Some(&job), None);
            let session = self.idle.remove(&account);
            if session.is_none() {
                self.places += 1;
            }
            self.busy.insert(account.clone());
            self.last_used.insert(account.clone(), Instant::now());
            let lightpanda = self.lightpanda.clone();
            let doing = Doing::Job {
                account: account.clone(),
                job: Box::new(job.clone()),
            };
            self.spawn(doing, async move {
                Task::Job(Box::new(run_job(&lightpanda, account, job, session).await))
            });
        }
        Ok(())
    }

    /// The free served accounts (none busy or closing): open sessions first, then the
    /// least recently used.
    fn claim_order(&self) -> Vec<String> {
        let mut order: Vec<String> = self
            .served
            .iter()
            .filter(|account| !self.busy.contains(*account) && !self.closing.contains(*account))
            .cloned()
            .collect();
        order.sort_by_key(|account| {
            (
                !self.idle.contains_key(account),
                self.last_used.get(account).copied(),
            )
        });
        order
    }

    fn close_longest_idle(&mut self) {
        if let Some(account) = self
            .idle
            .iter()
            .min_by_key(|(_, session)| session.used)
            .map(|(account, _)| account.clone())
        {
            self.close(&account, false);
        }
    }

    /// Close `account`'s idle session (Lightpanda saves its jar then); with
    /// `logged_out`, the jar then forgets the login Instagram ended.
    fn close(&mut self, account: &str, logged_out: bool) {
        if let Some(session) = self.idle.remove(account) {
            self.close_session(account, session, logged_out);
        }
    }

    fn close_session(&mut self, account: &str, session: Session, logged_out: bool) {
        let lightpanda = self.lightpanda.clone();
        self.closing.insert(account.to_owned());
        let doing = Doing::Close {
            account: account.to_owned(),
        };
        let account = account.to_owned();
        self.spawn(doing, async move {
            shut(&lightpanda, &account, session.browser, logged_out).await;
            Task::Closed
        });
    }

    /// Log one more account in at the ramp's turn, while a session place is free.
    fn maybe_ramp(&mut self) {
        if self.places >= CONTROL.max_sessions
            || self
                .doing
                .values()
                .any(|doing| matches!(doing, Doing::Ramp))
        {
            return;
        }
        match ramp::take_turn(&self.queue, self.bridge.time()) {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                tracing::error!("Lightpanda ramp could not take its turn: {error:#}");
                return;
            }
        }
        self.places += 1;
        let (lightpanda, queue, bridge) = (
            self.lightpanda.clone(),
            self.queue.clone(),
            self.bridge.clone(),
        );
        self.spawn(Doing::Ramp, async move {
            match ramp::step(&lightpanda, &queue, bridge).await {
                Ok(Some((account, result))) => tracing::info!(
                    "Lightpanda ramp: {account} {}",
                    match result {
                        LoginResult::AlreadyLoggedIn => "was already logged in".to_owned(),
                        LoginResult::LoggedIn { new_device } =>
                            format!("logged in (new device: {new_device})"),
                        LoginResult::Skipped(reason) => format!("was not tried: {reason}"),
                        LoginResult::Paused(reason) => format!("waits for a person: {reason}"),
                    }
                ),
                Ok(None) => {}
                Err(error) => tracing::error!("Lightpanda ramp failed: {error:#}"),
            }
            Task::Ramp
        });
    }

    fn spawn(&mut self, doing: Doing, task: impl Future<Output = Task> + 'static) {
        let handle = self.tasks.spawn_local(task);
        self.doing.insert(handle.id(), doing);
    }

    /// Take a finished task in: a job's outcome goes to the queue, and its session back
    /// to the idle ones while it is healthy. A task that panicked frees what it held,
    /// and its job is settled as a failure.
    fn settle(&mut self, done: Result<(Id, Task), JoinError>) {
        let (id, task) = match done {
            Ok((id, task)) => (id, Some(task)),
            Err(error) => {
                tracing::error!("A Lightpanda task failed: {error}");
                (error.id(), None)
            }
        };
        let Some(doing) = self.doing.remove(&id) else {
            return;
        };
        let ran = match (task, doing) {
            (Some(Task::Job(ran)), _) => *ran,
            (_, Doing::Job { account, job }) => Ran {
                account,
                job: *job,
                outcome: Err(BrowserError::transient("the Lightpanda task failed")),
                session: None,
                logged_out: false,
            },
            (_, Doing::Ramp) => {
                self.places -= 1;
                self.refreshed = None;
                return;
            }
            (_, Doing::Close { account }) => {
                self.places -= 1;
                self.closing.remove(&account);
                return;
            }
        };
        if let Err(error) = self.settle_job(ran) {
            tracing::error!("A Lightpanda job could not be recorded: {error}");
        }
    }

    fn settle_job(&mut self, ran: Ran) -> BrowserResult<()> {
        let Ran {
            account,
            job,
            outcome,
            session,
            logged_out,
        } = ran;
        self.busy.remove(&account);
        let error = match outcome {
            Ok(result) => {
                match session {
                    Some(session) => {
                        self.idle.insert(account.clone(), session);
                    }
                    None => self.places -= 1,
                }
                let read = LaneRead {
                    account,
                    held: false,
                };
                let finished = self
                    .queue
                    .finish_lightpanda(&job, Finish::result(result), &read);
                self.record(&job);
                return finished;
            }
            Err(error) => error,
        };
        // A failed session starts afresh next time.
        match session {
            Some(session) => self.close_session(&account, session, logged_out),
            None => self.places -= 1,
        }
        let message = error.to_string();
        if logged_out {
            tracing::warn!("Instagram ended {account}'s Lightpanda login");
            self.accounts.retain(|served| *served != account);
            self.served.retain(|served| *served != account);
        }
        tracing::warn!("Lightpanda job {} failed for {account}: {message}", job.id);
        let failed = Failed::of(&job, &error, logged_out);
        let read = LaneRead {
            account,
            held: failed.hold,
        };
        let outcome = Finish {
            result: None,
            error: Some(message),
            requeue: failed.retry,
            refund_rate_limit: failed.hand_back,
        };
        // The hold goes in with the finish, so the lane never takes the job again
        // while the account is held, and Brave takes it once the lane says so.
        let finished = self.queue.finish_lightpanda(&job, outcome, &read);
        if failed.hand_back {
            self.publish()?;
        }
        self.record(&job);
        finished
    }

    fn record(&self, job: &BrowserJob) {
        if let Ok(Some(completed)) = self.queue.get(&job.id) {
            self.queue
                .record_diagnostic(&completed.state, Some(&completed), None);
        }
    }

    /// Let the reads under way finish for a moment, hand everything back to Brave and
    /// close every session, all inside the worker's own stop.
    async fn shut_down(mut self) {
        let started = tokio::time::Instant::now();
        while !self.busy.is_empty() {
            match tokio::time::timeout_at(started + SHUTDOWN_READS, self.tasks.join_next_with_id())
                .await
            {
                Ok(Some(done)) => self.settle(done),
                _ => break,
            }
        }
        if let Err(error) = self.queue.set_lightpanda_lane(&[], &[], 0) {
            tracing::error!("The Lightpanda lane could not hand its work back: {error}");
        }
        let idle: Vec<String> = self.idle.keys().cloned().collect();
        for account in idle {
            self.close(&account, false);
        }
        while let Ok(Some(done)) =
            tokio::time::timeout_at(started + SHUTDOWN_ALL, self.tasks.join_next_with_id()).await
        {
            self.doing
                .remove(&done.map_or_else(|error| error.id(), |(id, _)| id));
        }
        // Whatever is still running is stopped with the lane: its processes are killed,
        // and its jobs are the worker's next recovery's.
    }
}

/// Whether the lane reads digests (`digest_engine`).
fn reads_digests() -> bool {
    INSTAGRAM_DIGEST.digest_engine == DigestEngine::Lightpanda
}

/// What becomes of a job that failed in Lightpanda.
#[derive(Debug, PartialEq, Eq)]
struct Failed {
    /// Hold the account, so its digests go to Brave and its reads wait.
    hold: bool,
    /// Pending again without spending an attempt, for Brave or another account: a
    /// digest, a read Instagram refused, or one whose session had lost its login.
    hand_back: bool,
    /// Pending again.
    retry: bool,
}

impl Failed {
    fn of(job: &BrowserJob, error: &BrowserError, logged_out: bool) -> Self {
        let hand_back = job.kind == "digest" || error.is(SessionKind::RateLimited) || logged_out;
        let transient = error.is(SessionKind::AutomationTransient)
            || error.is(SessionKind::PageUnavailable)
            || error.is_timeout();
        Self {
            // A logged-out account leaves the lane until it logs in again instead.
            hold: hand_back && !logged_out,
            hand_back,
            retry: hand_back
                || (transient && job.attempts < instagram_browser().ingestion_retry_limit),
        }
    }
}

/// The whole time a job may take in the lane, opening its session included.
fn job_deadline(job: &BrowserJob) -> Duration {
    Duration::from_secs_f64(if job.kind == "digest" {
        CONTROL.lane_digest_timeout_seconds
    } else {
        CONTROL.lane_following_timeout_seconds
    })
}

/// Run `job` in `account`'s session, opening one first when it has none, all within
/// the job's deadline.
async fn run_job(
    lightpanda: &Lightpanda,
    account: String,
    job: BrowserJob,
    session: Option<Session>,
) -> Ran {
    let deadline = tokio::time::Instant::now() + job_deadline(&job);
    let failed = |outcome: BrowserError, logged_out| Ran {
        account: account.clone(),
        job: job.clone(),
        outcome: Err(outcome),
        session: None,
        logged_out,
    };
    let mut session = match session {
        Some(session) => session,
        None => match tokio::time::timeout_at(deadline, open(lightpanda, &account)).await {
            Ok(Ok(session)) => session,
            Ok(Err(Opened::LoggedOut)) => {
                return failed(
                    BrowserError::page_unavailable("Instagram ended the Lightpanda login"),
                    true,
                );
            }
            // Not starting is a hand-back: the read never reached Instagram.
            Ok(Err(Opened::Failed(error))) => {
                return failed(
                    BrowserError::rate_limited(format!("Lightpanda could not start: {error:#}")),
                    false,
                );
            }
            Err(_) => {
                return failed(
                    BrowserError::rate_limited("Lightpanda did not start in time"),
                    false,
                );
            }
        },
    };
    let outcome =
        match tokio::time::timeout_at(deadline, execute(&mut session, &account, &job)).await {
            Ok(outcome) => outcome,
            Err(_) => Err(BrowserError::Timeout(
                "Lightpanda did not finish the job in time".to_owned(),
            )),
        };
    session.used = Instant::now();
    let logged_out = outcome.is_err()
        && tokio::time::timeout(SESSION_CHECK, session.browser.has_session())
            .await
            .is_ok_and(|held| held.is_ok_and(|held| !held));
    Ran {
        account,
        job,
        outcome,
        session: Some(session),
        logged_out,
    }
}

async fn execute(session: &mut Session, account: &str, job: &BrowserJob) -> BrowserResult<Value> {
    let text = |key: &str| job.payload.get(key).map(pyjson::str).unwrap_or_default();
    let optional = |key: &str| job.payload.get(key).and_then(Value::as_str);
    match job.kind.as_str() {
        "digest" => digest::resolve(
            &mut session.browser,
            &job.recipient_id,
            account,
            &text("cache_ent_id"),
        )
        .await
        .map(|resolution| resolution.to_value()),
        "following" => {
            following::read_page(
                &mut session.browser,
                account,
                &session.user_id,
                &text("username"),
                optional("user_id"),
                optional("max_id"),
            )
            .await
        }
        kind => Err(BrowserError::Value(format!(
            "Lightpanda does not run {kind} jobs"
        ))),
    }
}

enum Opened {
    LoggedOut,
    Failed(anyhow::Error),
}

/// Open `account`'s Lightpanda on Instagram and read whom it is logged in as.
async fn open(lightpanda: &Lightpanda, account: &str) -> Result<Session, Opened> {
    let mut browser = lightpanda.open(account).await.map_err(Opened::Failed)?;
    let user_id = match browser.user_id().await {
        Ok(Some(user_id)) => user_id,
        found => {
            let logged_out =
                matches!(found, Ok(None)) && browser.has_session().await.is_ok_and(|held| !held);
            shut(lightpanda, account, browser, logged_out).await;
            return Err(if logged_out {
                Opened::LoggedOut
            } else {
                Opened::Failed(anyhow::anyhow!("the session names no Instagram user"))
            });
        }
    };
    Ok(Session {
        browser,
        user_id,
        opened: Instant::now(),
        used: Instant::now(),
    })
}

/// Close a session; with `logged_out`, forget the login Instagram ended.
async fn shut(lightpanda: &Lightpanda, account: &str, browser: Browser, logged_out: bool) {
    if let Err(error) = browser.close().await {
        tracing::warn!("{account}'s Lightpanda did not close cleanly: {error:#}");
    }
    if logged_out && let Err(error) = lightpanda.jar(account).and_then(|jar| jar.forget_login()) {
        tracing::error!("{account}'s ended Lightpanda login could not be forgotten: {error:#}");
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::*;
    use crate::instagram_notifications::test_support::{FakeHost, bridge, queue};

    #[test]
    fn a_digest_and_its_wait_leave_brave_time_before_the_workflow_gives_up() {
        let digest = job_deadline(&job("digest", 1)).as_secs_f64();
        assert_eq!(digest, CONTROL.lane_digest_timeout_seconds);
        assert!(digest + CONTROL.lane_digest_wait_seconds <= 180.0);
        assert_eq!(
            job_deadline(&job("following", 1)).as_secs_f64(),
            CONTROL.lane_following_timeout_seconds
        );
    }

    #[tokio::test]
    async fn a_panicked_job_frees_its_account_and_settles_its_job() {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async {
                let directory = tempfile::tempdir().unwrap();
                let host = FakeHost::idle();
                let queue = queue(directory.path(), &host);
                let lightpanda =
                    Lightpanda::new("/nonexistent".into(), directory.path().join("lightpanda"))
                        .unwrap();
                let mut lane = Lane::new(
                    Rc::new(lightpanda),
                    queue.clone(),
                    bridge(&host),
                    Arc::new(Event::default()),
                );
                let account = "wat2do.mun".to_owned();
                queue
                    .set_lightpanda_lane(&[], std::slice::from_ref(&account), 1)
                    .unwrap();
                queue
                    .enqueue_following("mun", &account, "crawl-1", "club.one", Some("101"), None)
                    .unwrap();
                let claimed = queue
                    .claim_lightpanda(&account, false, true)
                    .unwrap()
                    .unwrap();
                lane.busy.insert(account.clone());
                lane.places = 1;
                let doing = Doing::Job {
                    account: account.clone(),
                    job: Box::new(claimed.clone()),
                };
                lane.spawn(doing, async { panic!("a bug in the lane") });

                let done = lane.tasks.join_next_with_id().await.unwrap();
                lane.settle(done);

                assert!(lane.busy.is_empty());
                assert_eq!(lane.places, 0);
                assert!(lane.doing.is_empty());
                let settled = queue.get(&claimed.id).unwrap().unwrap();
                assert_eq!(settled.state, "pending");
            })
            .await;
    }

    fn job(kind: &str, attempts: i64) -> BrowserJob {
        BrowserJob {
            id: "job".into(),
            kind: kind.into(),
            school: "mun".into(),
            recipient_id: "101".into(),
            account_username: "wat2do.mun".into(),
            payload: Map::new(),
            state: "running".into(),
            created_at: 0.0,
            started_at: Some(1.0),
            result: None,
            error: None,
            attempts,
        }
    }

    fn failed(kind: &str, attempts: i64, error: BrowserError, logged_out: bool) -> Failed {
        Failed::of(&job(kind, attempts), &error, logged_out)
    }

    #[test]
    fn a_digest_that_fails_goes_back_to_brave_and_holds_the_account() {
        let digest = failed("digest", 1, BrowserError::digest("invalid"), false);
        assert_eq!(
            digest,
            Failed {
                hold: true,
                hand_back: true,
                retry: true
            }
        );
    }

    #[test]
    fn a_refused_read_moves_to_another_account() {
        let refused = failed("following", 3, BrowserError::rate_limited("429"), false);
        assert_eq!(
            refused,
            Failed {
                hold: true,
                hand_back: true,
                retry: true
            }
        );
    }

    #[test]
    fn a_logged_out_session_hands_back_without_a_hold() {
        let ended = failed("following", 1, BrowserError::page_unavailable("x"), true);
        assert_eq!(
            ended,
            Failed {
                hold: false,
                hand_back: true,
                retry: true
            }
        );
    }

    #[test]
    fn other_following_failures_retry_until_the_limit_like_brave() {
        let limit = instagram_browser().ingestion_retry_limit;
        let page = || BrowserError::page_unavailable("Instagram Following read failed");
        assert!(failed("following", 1, page(), false).retry);
        assert!(!failed("following", limit, page(), false).retry);
        let invalid = failed("following", 1, BrowserError::session("invalid page"), false);
        assert_eq!(
            invalid,
            Failed {
                hold: false,
                hand_back: false,
                retry: false
            }
        );
    }
}
