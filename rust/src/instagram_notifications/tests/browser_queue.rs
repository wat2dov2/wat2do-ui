//! Ported from `tests/services/instagram_notifications/test_browser_queue.py`.
//!
//! Python patched `time` (`_clock`) and `_connect`; here a scripted [`Clock`] host
//! stands in for the first (with hooks where Python ran code inside `time.sleep`), and
//! real SQLite conditions stand in for the second: a second connection holding the
//! write lock produces `SQLITE_BUSY`, a trigger breaks a row or an insert, and a
//! non-database file stands in for corruption.

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Barrier, Mutex};

use super::*;
use crate::controlbox::overrides;
use crate::host::{CommandError, CommandOutput};
use crate::instagram_notifications::errors::SessionKind;

const RECIPIENT_ID: &str = "12342599092";
const ACCOUNT_USERNAME: &str = "ubc.wat2do.io";

type Hook = Mutex<Option<Box<dyn FnMut() + Send>>>;

thread_local! {
    /// Python's `threading.local()` clock in the simultaneous rate limit test.
    static LOCAL_NOW: Cell<Option<f64>> = const { Cell::new(None) };
}

/// Python's `_clock`: wall time and elapsed time that move only on sleep, with hooks
/// for the code Python ran inside `time.sleep` (`after_sleep`) or a patched method.
struct Clock {
    now: Mutex<f64>,
    elapsed: Mutex<f64>,
    /// Added to the wall clock on each read, so unpatched tests see time move forward.
    tick: f64,
    sleeps: Mutex<Vec<f64>>,
    after_sleep: Hook,
    on_time: Hook,
    on_monotonic: Hook,
}

impl Clock {
    fn new(now: f64, tick: f64) -> Arc<Self> {
        Arc::new(Self {
            now: Mutex::new(now),
            elapsed: Mutex::new(0.0),
            tick,
            sleeps: Mutex::new(Vec::new()),
            after_sleep: Mutex::new(None),
            on_time: Mutex::new(None),
            on_monotonic: Mutex::new(None),
        })
    }

    fn now(&self) -> f64 {
        *self.now.lock().unwrap()
    }

    fn set_now(&self, now: f64) {
        *self.now.lock().unwrap() = now;
    }

    fn add(&self, seconds: f64) {
        *self.now.lock().unwrap() += seconds;
    }

    fn elapsed(&self) -> f64 {
        *self.elapsed.lock().unwrap()
    }

    fn sleeps(&self) -> Vec<f64> {
        self.sleeps.lock().unwrap().clone()
    }

    fn after_sleep(&self, hook: impl FnMut() + Send + 'static) {
        *self.after_sleep.lock().unwrap() = Some(Box::new(hook));
    }

    fn on_time(&self, hook: impl FnMut() + Send + 'static) {
        *self.on_time.lock().unwrap() = Some(Box::new(hook));
    }

    fn on_monotonic(&self, hook: impl FnMut() + Send + 'static) {
        *self.on_monotonic.lock().unwrap() = Some(Box::new(hook));
    }
}

/// Run a hook outside its lock, so a hook that calls back into the queue cannot deadlock.
fn fire(hook: &Hook) {
    let taken = hook.lock().unwrap().take();
    if let Some(mut run) = taken {
        run();
        let mut slot = hook.lock().unwrap();
        if slot.is_none() {
            *slot = Some(run);
        }
    }
}

impl Host for Clock {
    fn run(
        &self,
        _program: &str,
        _args: &[String],
        _stdin: Option<&str>,
        _timeout: f64,
    ) -> Result<CommandOutput, CommandError> {
        panic!("the queue never starts subprocesses");
    }

    fn monotonic(&self) -> f64 {
        fire(&self.on_monotonic);
        self.elapsed()
    }

    fn time(&self) -> f64 {
        fire(&self.on_time);
        if let Some(now) = LOCAL_NOW.with(Cell::get) {
            return now;
        }
        let mut now = self.now.lock().unwrap();
        *now += self.tick;
        *now
    }

    fn sleep(&self, seconds: f64) {
        self.sleeps.lock().unwrap().push(seconds);
        *self.elapsed.lock().unwrap() += seconds;
        *self.now.lock().unwrap() += seconds;
        fire(&self.after_sleep);
    }
}

struct Fixture {
    _directory: tempfile::TempDir,
    clock: Arc<Clock>,
    queue: Arc<BrowserJobQueue>,
}

impl Fixture {
    fn with_clock(clock: Arc<Clock>) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let queue = open(&directory.path().join("browser"), &clock);
        Self {
            _directory: directory,
            clock,
            queue,
        }
    }

    fn reopen(&self) -> Arc<BrowserJobQueue> {
        open(&self.queue.state_directory, &self.clock)
    }
}

/// The `queue` fixture on a wall clock that always moves forward.
fn fixture() -> Fixture {
    Fixture::with_clock(Clock::new(1_800_000_000.0, 0.001))
}

/// The `queue` fixture with `_clock(monkeypatch)`.
fn clocked() -> Fixture {
    Fixture::with_clock(Clock::new(10_000.0, 0.0))
}

fn open(directory: &Path, clock: &Arc<Clock>) -> Arc<BrowserJobQueue> {
    BrowserJobQueue::open(Some(directory), clock.clone()).expect("queue opens")
}

fn open_error(directory: &Path, clock: &Arc<Clock>) -> BrowserError {
    match BrowserJobQueue::open(Some(directory), clock.clone()) {
        Ok(_) => panic!("queue unexpectedly opened"),
        Err(error) => error,
    }
}

fn engagement_in(queue: &BrowserJobQueue, shortcode: &str, school: &str, event_id: i64) -> String {
    queue
        .enqueue_engagement(
            school,
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            &format!("https://www.instagram.com/p/{shortcode}/"),
            Some(event_id),
            false,
        )
        .unwrap()
}

/// Python's `_engagement(queue, shortcode)`.
fn engagement(queue: &BrowserJobQueue, shortcode: &str) -> String {
    engagement_in(queue, shortcode, "ubc", 1)
}

fn digest(queue: &BrowserJobQueue, cache_ent_id: &str) -> BrowserJob {
    queue
        .enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, cache_ent_id)
        .unwrap()
}

fn retrieval(queue: &BrowserJobQueue, url: &str) -> String {
    queue
        .enqueue_retrieval("ubc", RECIPIENT_ID, ACCOUNT_USERNAME, url, 1)
        .unwrap()
}

fn claim(queue: &BrowserJobQueue) -> Option<BrowserJob> {
    queue.claim_next(None, true).unwrap()
}

fn job(queue: &BrowserJobQueue, id: &str) -> BrowserJob {
    queue.get(id).unwrap().expect("job exists")
}

fn succeeded() -> Finish {
    Finish::result(json!({"status": "succeeded"}))
}

fn requeue(error: &str) -> Finish {
    Finish {
        error: Some(error.to_owned()),
        requeue: true,
        ..Finish::default()
    }
}

fn refund(error: &str) -> Finish {
    Finish {
        refund_rate_limit: true,
        ..requeue(error)
    }
}

/// Python's `_complete_next`.
fn complete_next(queue: &BrowserJobQueue, allow_engagement: bool) -> Option<BrowserJob> {
    let job = queue.claim_next(None, allow_engagement).unwrap();
    if let Some(job) = &job {
        queue.finish(job, succeeded()).unwrap();
    }
    job
}

fn paused(queue: &BrowserJobQueue) -> bool {
    pyjson::truthy(&queue.setting_or("paused", json!(false)).unwrap())
}

fn setting_f64(queue: &BrowserJobQueue, key: &str) -> Option<f64> {
    queue
        .get_setting(key)
        .unwrap()
        .map(|value| value.as_f64().expect("numeric setting"))
}

fn raw_setting(queue: &BrowserJobQueue, key: &str) -> Option<String> {
    db(queue)
        .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
            row.get(0)
        })
        .optional()
        .unwrap()
}

/// Store `raw` exactly as Python's `set_setting` would (`json.dumps(value)`).
fn store_raw_setting(queue: &BrowserJobQueue, key: &str, raw: &str) {
    db(queue).execute(UPSERT_SETTING, [key, raw]).unwrap();
}

fn db(queue: &BrowserJobQueue) -> Connection {
    Connection::open(&queue.database_path).unwrap()
}

/// A second connection that fails at once instead of waiting for the queue's lock.
fn writer(queue: &BrowserJobQueue) -> Connection {
    let connection = db(queue);
    connection.busy_timeout(Duration::ZERO).unwrap();
    connection
}

fn release(connection: &Connection) {
    if !connection.is_autocommit() {
        connection.execute_batch("ROLLBACK").unwrap();
    }
}

fn raw_events(queue: &BrowserJobQueue) -> Vec<String> {
    let connection = db(queue);
    let mut statement = connection
        .prepare("SELECT event FROM diagnostic_events ORDER BY rowid")
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn events(queue: &BrowserJobQueue) -> Vec<Value> {
    raw_events(queue)
        .iter()
        .map(|event| serde_json::from_str(event).unwrap())
        .collect()
}

fn event_count(queue: &BrowserJobQueue) -> i64 {
    db(queue)
        .query_row("SELECT COUNT(*) FROM diagnostic_events", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn started_at(queue: &BrowserJobQueue, id: &str) -> Option<f64> {
    db(queue)
        .query_row("SELECT started_at FROM jobs WHERE id=?", [id], |row| {
            row.get(0)
        })
        .unwrap()
}

fn value_error<T>(result: BrowserResult<T>) -> String {
    match result {
        Err(BrowserError::Value(message)) => message,
        Err(other) => panic!("expected ValueError, got {other}"),
        Ok(_) => panic!("expected ValueError"),
    }
}

fn digest_error<T>(result: BrowserResult<T>) -> String {
    match result {
        Err(error) if error.is(SessionKind::Digest) => error.to_string(),
        Err(other) => panic!("expected BrowserDigestError, got {other}"),
        Ok(_) => panic!("expected BrowserDigestError"),
    }
}

fn storage_error<T>(result: BrowserResult<T>) {
    match result {
        Err(error) if error.is_storage() => {}
        Err(other) => panic!("expected sqlite3.Error, got {other}"),
        Ok(_) => panic!("expected sqlite3.Error"),
    }
}

fn resolve(queue: &BrowserJobQueue, cache_ent_id: &str) -> BrowserResult<DigestResolution> {
    queue.resolve_digest(RECIPIENT_ID, ACCOUNT_USERNAME, cache_ent_id)
}

fn backoff() -> f64 {
    control().rate_limit_backoff_seconds
}

fn digest_result() -> Value {
    json!({"account_username": ACCOUNT_USERNAME, "media_ids": ["123"], "page_count": 1})
}

#[test]
fn test_delivery_generation_survives_reopen_and_changes_for_a_recreated_queue() {
    let directory = tempfile::tempdir().unwrap();
    let directory = directory.path().join("delivery");
    let clock = Clock::new(1_800_000_000.0, 0.001);
    let first = open(&directory, &clock);
    let generation = first.delivery_generation().to_owned();
    assert_eq!(
        uuid::Uuid::parse_str(&generation)
            .unwrap()
            .hyphenated()
            .to_string(),
        generation
    );
    {
        let connection = db(&first);
        let mode: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let vacuum: i64 = connection
            .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .unwrap();
        assert_eq!(vacuum, 2);
        let jobs: i64 = connection
            .query_row("SELECT count(*) FROM jobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(jobs, 0);
    }
    assert_eq!(open(&directory, &clock).delivery_generation(), generation);
    for entry in std::fs::read_dir(&directory).unwrap() {
        let path = entry.unwrap().path();
        if path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jobs.sqlite3")
        {
            std::fs::remove_file(path).unwrap();
        }
    }
    assert_ne!(open(&directory, &clock).delivery_generation(), generation);
}

#[test]
fn test_concurrent_queue_initialization_shares_one_delivery_generation() {
    let directory = tempfile::tempdir().unwrap();
    let directory = directory.path().join("delivery");
    let clock = Clock::new(1_800_000_000.0, 0.001);
    let generations = Mutex::new(HashSet::new());
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| {
                while next.fetch_add(1, Ordering::SeqCst) < 8 {
                    let generation = open(&directory, &clock).delivery_generation().to_owned();
                    generations.lock().unwrap().insert(generation);
                }
            });
        }
    });
    assert_eq!(generations.lock().unwrap().len(), 1);
}

#[test]
fn test_current_queue_reopens_without_writer_admission_during_wal_maintenance() {
    let f = fixture();
    f.queue
        .set_setting("paused", json!("Operator safety hold"))
        .unwrap();
    overrides::instagram_browser(|control| {
        control.storage_busy_timeout_seconds = 0.01;
        control.storage_retry_limit = 1;
    });
    let writer = writer(&f.queue);
    writer
        .execute_batch("BEGIN IMMEDIATE; UPDATE settings SET value='false' WHERE key='paused'")
        .unwrap();
    let reopened = f.reopen();
    assert!(!writer.is_autocommit());
    assert_eq!(
        reopened.delivery_generation(),
        f.queue.delivery_generation()
    );
    assert_eq!(
        reopened.get_setting("paused").unwrap(),
        Some(json!("Operator safety hold"))
    );
    assert!(!reopened.is_storage_unavailable());
    release(&writer);
}

#[test]
fn test_incomplete_queue_requires_bounded_migration_then_reopens_under_writer() {
    for legacy_change in ["DROP INDEX jobs_waiting", "DROP TABLE diagnostic_events"] {
        let f = fixture();
        let job_id = engagement(&f.queue, "MigrationHistory");
        f.queue
            .set_setting("paused", json!("Operator safety hold"))
            .unwrap();
        db(&f.queue).execute_batch(legacy_change).unwrap();
        overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
        let writer = Arc::new(Mutex::new(writer(&f.queue)));
        writer
            .lock()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE")
            .unwrap();
        let held = writer.clone();
        f.clock.after_sleep(move || release(&held.lock().unwrap()));
        let reopened = f.reopen();
        let interval = control().storage_retry_interval_seconds;
        assert_eq!(f.clock.sleeps(), vec![interval], "{legacy_change}");
        assert_eq!(
            reopened.delivery_generation(),
            f.queue.delivery_generation()
        );
        assert_eq!(job(&reopened, &job_id).state, "pending");
        assert_eq!(
            reopened.get_setting("paused").unwrap(),
            Some(json!("Operator safety hold"))
        );
        // The repaired table/index/ALTER format must now qualify for the fast
        // path, not force every future constructor back through migrations.
        writer
            .lock()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE")
            .unwrap();
        let again = f.reopen();
        assert!(!writer.lock().unwrap().is_autocommit());
        assert_eq!(f.clock.sleeps(), vec![interval]);
        assert_eq!(again.delivery_generation(), f.queue.delivery_generation());
        release(&writer.lock().unwrap());
    }
}

#[test]
fn test_current_queue_refuses_invalid_generation_without_reset_or_writer_admission() {
    for raw_generation in ["\"not-a-uuid\"", "not-json"] {
        let f = fixture();
        db(&f.queue)
            .execute(
                "UPDATE settings SET value=? WHERE key='delivery_generation'",
                [raw_generation],
            )
            .unwrap();
        overrides::instagram_browser(|control| {
            control.storage_busy_timeout_seconds = 0.01;
            control.storage_retry_limit = 1;
        });
        let writer = writer(&f.queue);
        writer.execute_batch("BEGIN IMMEDIATE").unwrap();
        let message = value_error::<()>(Err(open_error(&f.queue.state_directory, &f.clock)));
        assert!(message.contains("Browser queue delivery generation is invalid"));
        assert!(!writer.is_autocommit());
        let stored: String = writer
            .query_row(
                "SELECT value FROM settings WHERE key='delivery_generation'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, raw_generation);
        release(&writer);
    }
}

#[test]
fn test_missing_delivery_generation_uses_existing_initialization_without_losing_history() {
    let f = fixture();
    let job_id = engagement(&f.queue, "MissingGeneration");
    f.queue
        .set_setting("paused", json!("Operator safety hold"))
        .unwrap();
    db(&f.queue)
        .execute_batch("DELETE FROM settings WHERE key='delivery_generation'")
        .unwrap();
    let reopened = f.reopen();
    let generation = reopened.delivery_generation();
    assert_eq!(
        uuid::Uuid::parse_str(generation)
            .unwrap()
            .hyphenated()
            .to_string(),
        generation
    );
    assert_ne!(generation, f.queue.delivery_generation());
    assert_eq!(job(&reopened, &job_id).state, "pending");
    assert_eq!(
        reopened.get_setting("paused").unwrap(),
        Some(json!("Operator safety hold"))
    );
}

#[test]
fn test_recorded_engagement_sources_preserve_original_urls_and_reject_ambiguity() {
    let f = fixture();
    let queue = &f.queue;
    engagement_in(queue, "Original", "ubc", 7);
    let expected =
        vec![json!({"post_url": "https://www.instagram.com/p/Original/", "event_id": 7})];
    assert_eq!(
        queue
            .recorded_engagement_sources(RECIPIENT_ID, ACCOUNT_USERNAME, &[7])
            .unwrap(),
        expected
    );
    assert!(
        value_error(queue.recorded_engagement_sources(RECIPIENT_ID, ACCOUNT_USERNAME, &[7, 8]))
            .contains("faithfully")
    );
    engagement_in(queue, "Changed", "ubc", 7);
    assert!(
        value_error(queue.recorded_engagement_sources(RECIPIENT_ID, ACCOUNT_USERNAME, &[7]))
            .contains("faithfully")
    );
}

#[test]
fn test_new_digest_preempts_the_next_engagement_without_interrupting_running_job() {
    let f = fixture();
    let queue = &f.queue;
    let first_id = engagement(queue, "First");
    let second_id = engagement(queue, "Second");
    let running = claim(queue).unwrap();
    assert_eq!(running.id, first_id);

    let digest_id = digest(queue, "cache-priority").id;

    assert_eq!(job(queue, &first_id).state, "running");
    queue.finish(&job(queue, &first_id), succeeded()).unwrap();
    assert_eq!(complete_next(queue, true).unwrap().id, digest_id);
    assert_eq!(complete_next(queue, true).unwrap().id, second_id);
    assert!(claim(queue).is_none());
}

#[test]
fn test_engagement_cooldown_still_allows_immediate_digest_work() {
    let f = fixture();
    let queue = &f.queue;
    let engagement_id = engagement(queue, "Post1");
    assert!(queue.claim_next(None, false).unwrap().is_none());

    let digest_id = digest(queue, "cache-cooldown").id;

    assert_eq!(complete_next(queue, false).unwrap().id, digest_id);
    assert_eq!(job(queue, &engagement_id).state, "pending");
}

#[test]
fn test_shared_rate_limit_holds_every_browser_kind_until_expiry() {
    for kind in ["digest", "retrieval", "engagement"] {
        let f = clocked();
        let queue = &f.queue;
        let first_id = digest(queue, "rate-limit-active").id;
        let active = claim(queue).unwrap();
        let pending_id = match kind {
            "digest" => digest(queue, "rate-limit-next").id,
            "retrieval" => retrieval(queue, "https://www.instagram.com/p/RateLimited/"),
            _ => engagement(queue, "RateLimited"),
        };

        queue
            .defer_for_rate_limit(
                Some(&active),
                "Instagram public media request failed with HTTP 429",
            )
            .unwrap();

        assert!(queue.is_rate_limited(None, false).unwrap());
        assert!(claim(queue).is_none());
        assert!(
            queue
                .claim_companions(&active, 14, true)
                .unwrap()
                .is_empty()
        );
        assert_eq!(job(queue, &first_id).state, "running");
        assert_eq!(job(queue, &pending_id).state, "pending");
        assert_eq!(job(queue, &pending_id).attempts, 0);
        assert!(!paused(queue));
        f.clock.add(backoff());
        assert!(!queue.is_rate_limited(None, false).unwrap());
        assert_eq!(claim(queue).unwrap().id, pending_id, "{kind}");
    }
}

#[test]
fn test_rate_limit_uses_existing_sanitized_diagnostics_without_changing_the_job() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = retrieval(queue, "https://www.instagram.com/p/RateDiagnostic/");
    let active = claim(queue).unwrap();
    let mut untrusted_result = active.clone();
    untrusted_result.result = Some(json!({"response_body": "must-not-be-logged"}));
    untrusted_result
        .payload
        .insert("response_body".into(), json!("must-not-be-logged"));
    let reason = "Instagram public media request failed with HTTP 429";

    queue
        .defer_for_rate_limit(Some(&untrusted_result), reason)
        .unwrap();

    assert_eq!(queue.get(&job_id).unwrap(), Some(active));
    // A retrieval's 429 holds only retrievals.
    assert_eq!(queue.get_setting("browser_rate_limit_until").unwrap(), None);
    assert_eq!(
        setting_f64(queue, "retrieval_rate_limit_until"),
        Some(f.clock.now() + backoff())
    );
    // Stored with Python's float repr.
    assert_eq!(
        raw_setting(queue, "retrieval_rate_limit_until").as_deref(),
        Some("10120.0")
    );
    assert_eq!(
        raw_setting(queue, "retrieval_rate_limit_backoff_seconds").as_deref(),
        Some("120.0")
    );
    let events = events(queue);
    let event = events
        .iter()
        .find(|event| event["payload"]["state"] == "rate_limited")
        .unwrap();
    assert_eq!(
        event["payload"],
        json!({
            "state": "rate_limited",
            "job_id": job_id,
            "kind": "retrieval",
            "reason": reason,
            "recorded_at": f.clock.now(),
        })
    );
    assert_eq!(event["school"], "ubc");
    assert_eq!(event["ig_account"], ACCOUNT_USERNAME);
    assert_eq!(
        event["post_url"],
        "https://www.instagram.com/p/RateDiagnostic/"
    );
    assert!(!pyjson::dumps(event, None).contains("must-not-be-logged"));
}

#[test]
fn test_rate_limit_expiry_does_not_clear_human_recovery_pause() {
    let f = clocked();
    let queue = &f.queue;
    digest(queue, "rate-limit-auth");
    let active = claim(queue).unwrap();
    digest(queue, "rate-limit-after-auth");
    queue
        .set_setting(
            "paused",
            json!("Instagram browser requires human account recovery"),
        )
        .unwrap();

    queue
        .defer_for_rate_limit(Some(&active), "Instagram browser page returned HTTP 429")
        .unwrap();
    f.clock.add(backoff());

    assert!(!queue.is_rate_limited(None, false).unwrap());
    assert_eq!(
        queue.get_setting("paused").unwrap(),
        Some(json!("Instagram browser requires human account recovery"))
    );
    assert!(claim(queue).is_none());
    assert!(
        queue
            .claim_companions(&active, 14, true)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn test_rate_limited_maintenance_uses_the_same_cooldown_without_a_synthetic_job() {
    let f = clocked();
    let queue = &f.queue;
    let pending_id = digest(queue, "rate-limit-maintenance").id;
    let reason = "Instagram browser page returned HTTP 429";

    queue.defer_for_rate_limit(None, reason).unwrap();

    assert!(queue.is_rate_limited(None, false).unwrap());
    assert!(claim(queue).is_none());
    assert_eq!(job(queue, &pending_id).state, "pending");
    assert_eq!(job(queue, &pending_id).attempts, 0);
    assert!(!paused(queue));
    let raw = raw_events(queue);
    let index = raw
        .iter()
        .position(|event| event.contains("\"state\": \"rate_limited\""))
        .unwrap();
    // The stored text is Python's `json.dumps(event)`.
    assert_eq!(
        raw[index],
        "{\"event\": \"Browser worker: rate_limited\", \"sender_id\": \"instagram-browser-worker\", \
         \"school\": null, \"ig_account\": null, \"post_url\": null, \"payload\": {\"state\": \
         \"rate_limited\", \"job_id\": null, \"kind\": null, \"reason\": \"Instagram browser page \
         returned HTTP 429\", \"recorded_at\": 10000.0}}"
    );
    let event: Value = serde_json::from_str(&raw[index]).unwrap();
    assert_eq!(
        event["payload"],
        json!({
            "state": "rate_limited",
            "job_id": null,
            "kind": null,
            "reason": reason,
            "recorded_at": f.clock.now(),
        })
    );
    assert_eq!(event["school"], Value::Null);
    assert_eq!(event["ig_account"], Value::Null);
    assert_eq!(event["post_url"], Value::Null);
    f.clock.add(backoff());
    assert_eq!(claim(queue).unwrap().id, pending_id);
}

#[test]
fn test_rate_limit_requires_a_reason_before_writing_cooldown_or_diagnostics() {
    for reason in ["", "   "] {
        let f = fixture();
        let queue = &f.queue;
        assert!(
            value_error(queue.defer_for_rate_limit(None, reason)).contains("diagnostic reason")
        );

        assert!(!queue.is_rate_limited(None, false).unwrap());
        assert_eq!(event_count(queue), 0);
    }
}

#[test]
fn test_rate_limit_does_not_automatically_retry_uncertain_native_actions() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = engagement(queue, "RateLimitNative");
    let active = claim(queue).unwrap();
    queue
        .defer_for_rate_limit(Some(&active), "Instagram browser page returned HTTP 429")
        .unwrap();
    assert!(
        value_error(queue.finish(
            &job(queue, &job_id),
            requeue("Instagram browser page returned HTTP 429")
        ))
        .contains("Engagement cannot be automatically requeued")
    );
    queue
        .finish(
            &job(queue, &job_id),
            Finish::error("Instagram browser page returned HTTP 429"),
        )
        .unwrap();

    f.clock.add(backoff());

    assert!(!queue.is_rate_limited(None, false).unwrap());
    assert!(claim(queue).is_none());
    assert_eq!(job(queue, &job_id).state, "failed");
    assert_eq!(job(queue, &job_id).attempts, 1);
    queue.retry(&job_id).unwrap();
    assert_eq!(claim(queue).unwrap().id, job_id);
    assert_eq!(job(queue, &job_id).attempts, 2);
}

#[test]
fn test_rate_limit_for_an_inactive_claim_is_a_noop_without_ghost_diagnostics() {
    for state in [
        "missing",
        "pending",
        "succeeded",
        "failed",
        "cancelled",
        "stale_attempt",
        "stale_started_at",
    ] {
        let f = clocked();
        let queue = &f.queue;
        digest(queue, "rate-limit-noop");
        let mut active = claim(queue).unwrap();
        match state {
            "missing" => active.id = "missing-rate-limit-job".to_owned(),
            "stale_attempt" => active.attempts -= 1,
            "stale_started_at" => active.started_at = active.started_at.map(|at| at - 1.0),
            _ => {
                db(queue)
                    .execute(
                        "UPDATE jobs SET state=? WHERE id=?",
                        [state, active.id.as_str()],
                    )
                    .unwrap();
            }
        }
        let before = raw_events(queue);

        queue
            .defer_for_rate_limit(Some(&active), "Instagram browser page returned HTTP 429")
            .unwrap();

        assert!(!queue.is_rate_limited(None, false).unwrap(), "{state}");
        assert_eq!(queue.get_setting("browser_rate_limit_until").unwrap(), None);
        assert_eq!(raw_events(queue), before);
    }
}

#[test]
fn test_simultaneous_rate_limits_extend_one_shared_deadline_without_shortening_it() {
    let f = clocked();
    let queue = &f.queue;
    for index in 0..14 {
        digest(queue, &format!("rate-limit-concurrent-{index}"));
    }
    let jobs: Vec<BrowserJob> = (0..14).map(|_| claim(queue).unwrap()).collect();
    let now = f.clock.now();
    let entered = Barrier::new(14);
    std::thread::scope(|scope| {
        for (index, job) in jobs.iter().enumerate() {
            let entered = &entered;
            scope.spawn(move || {
                LOCAL_NOW.with(|local| local.set(Some(now + index as f64)));
                entered.wait();
                queue
                    .defer_for_rate_limit(Some(job), "Instagram browser page returned HTTP 429")
                    .unwrap();
            });
        }
    });
    let expected = now + 13.0 + backoff();
    assert_eq!(
        setting_f64(queue, "browser_rate_limit_until"),
        Some(expected)
    );
    queue
        .defer_for_rate_limit(Some(&jobs[0]), "Instagram browser page returned HTTP 429")
        .unwrap();
    assert_eq!(
        setting_f64(queue, "browser_rate_limit_until"),
        Some(expected)
    );
    assert!(queue.is_rate_limited(Some(expected - 0.01), false).unwrap());
    assert!(!queue.is_rate_limited(Some(expected), false).unwrap());
    let limited = events(queue)
        .iter()
        .filter(|event| event["payload"]["state"] == "rate_limited")
        .count();
    assert_eq!(limited, 15);
}

#[test]
fn test_fourteen_confirmed_rate_limits_after_expiry_increase_backoff_only_once() {
    let f = clocked();
    let queue = &f.queue;
    for index in 0..14 {
        digest(queue, &format!("progressive-rate-{index}"));
    }
    let original: Vec<BrowserJob> = (0..14).map(|_| claim(queue).unwrap()).collect();
    for job in &original {
        queue.defer_for_rate_limit(Some(job), "HTTP 429").unwrap();
        queue.finish(job, refund("HTTP 429")).unwrap();
    }
    f.clock.add(backoff());
    let fresh: Vec<BrowserJob> = (0..14).map(|_| claim(queue).unwrap()).collect();

    std::thread::scope(|scope| {
        for job in &fresh {
            scope.spawn(move || queue.defer_for_rate_limit(Some(job), "HTTP 429").unwrap());
        }
    });

    let expected = backoff() * 2.0;
    assert_eq!(
        setting_f64(queue, "browser_rate_limit_backoff_seconds"),
        Some(expected)
    );
    assert_eq!(
        setting_f64(queue, "browser_rate_limit_until"),
        Some(f.clock.now() + expected)
    );
    for job in &fresh {
        queue.finish(job, refund("HTTP 429")).unwrap();
        assert_eq!(self::job(queue, &job.id).state, "pending");
        assert_eq!(self::job(queue, &job.id).attempts, 0);
    }
    assert!(!paused(queue));
}

#[test]
fn test_progressive_backoff_survives_restart_and_caps_without_changing_human_pause() {
    let f = clocked();
    let mut queue = f.queue.clone();
    queue
        .set_setting("paused", json!("Instagram requires human account recovery"))
        .unwrap();
    let mut expected = backoff();
    for _round in 0..7 {
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        assert_eq!(
            setting_f64(&queue, "browser_rate_limit_backoff_seconds"),
            Some(expected)
        );
        assert_eq!(
            setting_f64(&queue, "browser_rate_limit_until"),
            Some(f.clock.now() + expected)
        );
        queue = f.reopen();
        assert!(queue.is_rate_limited(None, false).unwrap());
        assert_eq!(
            queue.get_setting("paused").unwrap(),
            Some(json!("Instagram requires human account recovery"))
        );
        f.clock.add(expected);
        expected = (expected * 2.0).min(control().rate_limit_max_backoff_seconds);
    }
    assert_eq!(
        setting_f64(&queue, "browser_rate_limit_backoff_seconds"),
        Some(control().rate_limit_max_backoff_seconds)
    );
}

#[test]
fn test_fresh_success_after_recovery_resets_backoff_but_keeps_deadline() {
    for kind in ["digest", "retrieval", "engagement", "inspection"] {
        let f = clocked();
        let queue = &f.queue;
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        f.clock.add(backoff());
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        let deadline = setting_f64(queue, "browser_rate_limit_until").unwrap();
        let held_backoff = setting_f64(queue, "browser_rate_limit_backoff_seconds").unwrap();
        f.clock
            .set_now(deadline + control().rate_limit_recovery_seconds);
        let job_id = match kind {
            "digest" => digest(queue, "progressive-reset").id,
            "retrieval" => retrieval(queue, "https://www.instagram.com/p/ProgressiveReset/"),
            _ => queue
                .enqueue_engagement(
                    "ubc",
                    RECIPIENT_ID,
                    ACCOUNT_USERNAME,
                    "https://www.instagram.com/p/ProgressiveReset/",
                    None,
                    kind == "inspection",
                )
                .unwrap(),
        };
        let active = claim(queue).unwrap();
        assert_eq!(active.id, job_id);
        assert_eq!(active.started_at, Some(f.clock.now()));

        queue.finish(&job(queue, &job_id), succeeded()).unwrap();

        assert_eq!(
            setting_f64(queue, "browser_rate_limit_until"),
            Some(deadline)
        );
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(if kind == "inspection" {
                held_backoff
            } else {
                0.0
            }),
            "{kind}"
        );
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        let expected = if kind == "inspection" {
            held_backoff * 2.0
        } else {
            backoff()
        };
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(expected)
        );
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_until"),
            Some(f.clock.now() + expected)
        );
    }
}

#[test]
fn test_one_success_after_cooldown_does_not_reset_sustained_rate_limits() {
    for kind in ["digest", "retrieval", "engagement"] {
        let f = clocked();
        let queue = &f.queue;
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        f.clock
            .set_now(setting_f64(queue, "browser_rate_limit_until").unwrap());
        let job_id = match kind {
            "digest" => digest(queue, "early-reset").id,
            "retrieval" => retrieval(queue, "https://www.instagram.com/p/EarlyReset/"),
            _ => engagement(queue, "EarlyReset"),
        };
        assert_eq!(claim(queue).unwrap().id, job_id);

        queue.finish(&job(queue, &job_id), succeeded()).unwrap();

        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(backoff()),
            "{kind}"
        );
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(backoff() * 2.0)
        );
    }
}

#[test]
fn test_rate_limit_recovery_requires_a_fresh_job_after_the_quiet_window() {
    for starts_after_recovery in [false, true] {
        let f = clocked();
        let queue = &f.queue;
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        let deadline = setting_f64(queue, "browser_rate_limit_until").unwrap();
        let recovered_at = deadline + control().rate_limit_recovery_seconds;
        f.clock.set_now(if starts_after_recovery {
            recovered_at
        } else {
            recovered_at - 0.01
        });
        let job_id = digest(queue, "recovery-boundary").id;
        claim(queue);
        f.clock.set_now(recovered_at + 1.0);

        queue.finish(&job(queue, &job_id), succeeded()).unwrap();

        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(if starts_after_recovery {
                0.0
            } else {
                backoff()
            })
        );
    }
}

#[test]
fn test_another_rate_limit_restarts_the_recovery_window() {
    let f = clocked();
    let queue = &f.queue;
    queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
    let original_recovery = setting_f64(queue, "browser_rate_limit_until").unwrap()
        + control().rate_limit_recovery_seconds;
    f.clock.set_now(original_recovery - 1.0);
    queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
    f.clock
        .set_now(setting_f64(queue, "browser_rate_limit_until").unwrap());
    assert!(f.clock.now() > original_recovery);
    let job_id = digest(queue, "renewed-recovery").id;
    claim(queue);

    queue.finish(&job(queue, &job_id), succeeded()).unwrap();

    assert_eq!(
        setting_f64(queue, "browser_rate_limit_backoff_seconds"),
        Some(backoff() * 2.0)
    );
}

#[test]
fn test_old_inflight_success_cannot_reset_active_or_expired_hold() {
    for finish_after_expiry in [false, true] {
        let f = clocked();
        let queue = &f.queue;
        let job_id = digest(queue, "progressive-old-response").id;
        let active = claim(queue).unwrap();
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        let deadline = setting_f64(queue, "browser_rate_limit_until").unwrap();
        if finish_after_expiry {
            f.clock.set_now(deadline);
        }

        queue.finish(&job(queue, &job_id), succeeded()).unwrap();

        assert!(active.started_at.unwrap() < deadline);
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_until"),
            Some(deadline)
        );
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            Some(backoff())
        );
    }
}

#[test]
fn test_non_success_or_unchanged_finish_cannot_reset_progressive_backoff() {
    for state in ["failed", "unsupported", "cancelled", "stale"] {
        let f = clocked();
        let queue = &f.queue;
        queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
        f.clock.add(backoff());
        let job_id = digest(queue, &format!("progressive-no-reset-{state}")).id;
        if state == "cancelled" {
            queue.cancel(&job_id).unwrap();
        } else {
            claim(queue);
            if state == "stale" {
                queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
                queue.finish(&job(queue, &job_id), succeeded()).unwrap();
                f.clock
                    .set_now(setting_f64(queue, "browser_rate_limit_until").unwrap());
            }
        }
        let deadline = setting_f64(queue, "browser_rate_limit_until");
        let held_backoff = setting_f64(queue, "browser_rate_limit_backoff_seconds");

        queue
            .finish(
                &job(queue, &job_id),
                Finish {
                    error: (state == "failed").then(|| "HTTP 400".to_owned()),
                    result: Some(json!({
                        "status": if state == "unsupported" { "unsupported" } else { "succeeded" }
                    })),
                    ..Finish::default()
                },
            )
            .unwrap();

        assert_eq!(setting_f64(queue, "browser_rate_limit_until"), deadline);
        assert_eq!(
            setting_f64(queue, "browser_rate_limit_backoff_seconds"),
            held_backoff,
            "{state}"
        );
    }
}

#[test]
fn test_digest_expires_normally_when_progressive_hold_exceeds_caller_deadline() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = digest(queue, "progressive-expired-caller").id;
    queue
        .set_setting(
            "browser_rate_limit_backoff_seconds",
            json!(control().rate_limit_max_backoff_seconds),
        )
        .unwrap();
    queue
        .set_setting("browser_rate_limit_until", json!(f.clock.now()))
        .unwrap();
    queue.defer_for_rate_limit(None, "HTTP 429").unwrap();
    assert!(control().rate_limit_max_backoff_seconds > control().result_timeout_seconds);
    f.clock.add(control().result_timeout_seconds + 1.0);
    assert!(claim(queue).is_none());
    assert_eq!(job(queue, &job_id).state, "pending");
    f.clock
        .set_now(setting_f64(queue, "browser_rate_limit_until").unwrap());

    assert!(claim(queue).is_none());

    let expired = job(queue, &job_id);
    assert_eq!(expired.state, "cancelled");
    assert_eq!(
        expired.error.as_deref(),
        Some("Digest caller deadline expired")
    );
    assert_eq!(expired.attempts, 0);
}

#[test]
fn test_invalid_progressive_backoff_cannot_admit_or_extend_browser_work() {
    // `json.dumps` of False, "later", [], nan, inf, -1, 1, backoff - 1, max + 1.
    let below = pyjson::float_repr(backoff() - 1.0);
    let above = pyjson::float_repr(control().rate_limit_max_backoff_seconds + 1.0);
    for raw in [
        "false",
        "\"later\"",
        "[]",
        "NaN",
        "Infinity",
        "-1",
        "1",
        below.as_str(),
        above.as_str(),
    ] {
        let f = clocked();
        let queue = &f.queue;
        let job_id = digest(queue, "progressive-invalid").id;
        store_raw_setting(queue, "browser_rate_limit_backoff_seconds", raw);

        let invalid = "Browser rate limit interval is invalid";
        assert!(
            value_error(queue.is_rate_limited(None, false)).contains(invalid),
            "{raw}"
        );
        assert!(value_error(queue.claim_next(None, true)).contains(invalid));
        assert!(value_error(queue.defer_for_rate_limit(None, "HTTP 429")).contains(invalid));
        assert_eq!(job(queue, &job_id).state, "pending");
        assert_eq!(job(queue, &job_id).attempts, 0);
        assert_eq!(queue.get_setting("browser_rate_limit_until").unwrap(), None);
    }
}

#[test]
fn test_invalid_rate_limit_deadline_cannot_admit_browser_work() {
    // `json.dumps` of True, "later", [], nan, inf.
    for raw in ["true", "\"later\"", "[]", "NaN", "Infinity"] {
        let f = clocked();
        let queue = &f.queue;
        digest(queue, "rate-limit-invalid-active");
        let active = claim(queue).unwrap();
        let pending_id = digest(queue, "rate-limit-invalid-next").id;
        store_raw_setting(queue, "browser_rate_limit_until", raw);

        let invalid = "Browser rate limit timestamp is invalid";
        assert!(
            value_error(queue.is_rate_limited(None, false)).contains(invalid),
            "{raw}"
        );
        assert!(value_error(queue.claim_next(None, true)).contains(invalid));
        assert!(value_error(queue.claim_companions(&active, 14, true)).contains(invalid));
        assert_eq!(job(queue, &pending_id).state, "pending");
        assert_eq!(job(queue, &pending_id).attempts, 0);
    }
}

#[test]
fn test_school_posts_stay_together_and_digest_preempts_between_posts() {
    let f = fixture();
    let queue = &f.queue;
    for index in 0..3 {
        engagement_in(queue, &format!("Ubc{index}"), "ubc", 1);
    }
    engagement_in(queue, "Sask", "usask", 1);
    assert_eq!(complete_next(queue, true).unwrap().school, "ubc");
    let digest_id = digest(queue, "urgent").id;
    assert_eq!(complete_next(queue, true).unwrap().id, digest_id);
    let schools: Vec<String> = (0..3)
        .map(|_| complete_next(queue, true).unwrap().school)
        .collect();
    assert_eq!(schools, ["ubc", "ubc", "usask"]);
}

#[test]
fn test_selected_school_survives_worker_restart() {
    let f = fixture();
    for school in ["ubc", "usask"] {
        for index in 0..2 {
            engagement_in(&f.queue, &format!("{school}{index}"), school, 1);
        }
    }
    let first = complete_next(&f.queue, true).unwrap();

    let reopened = f.reopen();
    let second = complete_next(&reopened, true).unwrap();

    assert_eq!(second.school, first.school);
}

#[test]
fn test_same_post_in_two_carousels_or_permalink_forms_has_one_job_per_post() {
    let f = fixture();
    let queue = &f.queue;
    let first = engagement_in(queue, "Shared", "ubc", 101);
    let second = queue
        .enqueue_engagement(
            "ubc",
            RECIPIENT_ID,
            &format!(" {} ", ACCOUNT_USERNAME.to_uppercase()),
            "https://www.instagram.com/reel/Shared/?igsh=tracking",
            Some(202),
            false,
        )
        .unwrap();
    assert_eq!(first, second);

    queue.finish(&claim(queue).unwrap(), succeeded()).unwrap();
    assert_eq!(engagement_in(queue, "Shared", "ubc", 303), first);
    assert_eq!(job(queue, &first).state, "succeeded");
    assert!(claim(queue).is_none());

    assert_eq!(engagement(queue, "Shared"), first);
}

#[test]
fn test_same_event_post_is_distinct_for_each_school_account() {
    let f = fixture();
    let queue = &f.queue;
    let first = engagement(queue, "Shared");
    let second = queue
        .enqueue_engagement(
            "usask",
            "41553815702",
            "usask.wat2do.io",
            "https://www.instagram.com/p/Shared/",
            Some(1),
            false,
        )
        .unwrap();

    assert_ne!(first, second);
    let completed: HashSet<String> = (0..2)
        .map(|_| complete_next(queue, true).unwrap().id)
        .collect();
    assert_eq!(completed, HashSet::from([first, second]));
}

#[test]
fn test_recovery_requeues_reads_but_never_repeats_ambiguous_engagement() {
    let f = fixture();
    let queue = &f.queue;
    let engagement_id = engagement(queue, "Post1");
    assert_eq!(claim(queue).unwrap().id, engagement_id);
    let digest_id = digest(queue, "cache-restart").id;
    assert_eq!(claim(queue).unwrap().id, digest_id);

    let reopened = f.reopen();
    reopened.recover_interrupted().unwrap();

    assert_eq!(job(&reopened, &digest_id).state, "pending");
    assert_eq!(job(&reopened, &engagement_id).state, "failed");
    assert!(
        job(&reopened, &engagement_id)
            .error
            .unwrap()
            .contains("inspect browser state")
    );
    assert_eq!(engagement(&reopened, "Post1"), engagement_id);
    assert_eq!(job(&reopened, &engagement_id).state, "failed");
    assert!(
        reopened
            .get_setting("paused")
            .unwrap()
            .unwrap()
            .as_str()
            .unwrap()
            .contains("inspect browser state")
    );
    assert!(claim(&reopened).is_none());
    reopened.set_setting("paused", json!(false)).unwrap();
    assert_eq!(complete_next(&reopened, true).unwrap().id, digest_id);
    assert!(claim(&reopened).is_none());

    reopened.retry(&engagement_id).unwrap();
    assert_eq!(claim(&reopened).unwrap().id, engagement_id);
}

#[test]
fn test_interrupted_engagement_preserves_existing_human_pause() {
    for dry_run in [false, true] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = queue
            .enqueue_engagement(
                "ubc",
                RECIPIENT_ID,
                ACCOUNT_USERNAME,
                "https://www.instagram.com/p/InterruptedInspection/",
                None,
                dry_run,
            )
            .unwrap();
        assert_eq!(claim(queue).unwrap().id, job_id);
        queue
            .set_setting("paused", json!("Instagram requires human reauthorization"))
            .unwrap();
        let reopened = f.reopen();
        reopened.recover_interrupted().unwrap();
        assert_eq!(
            reopened.get_setting("paused").unwrap(),
            Some(json!("Instagram requires human reauthorization"))
        );
        assert_eq!(job(&reopened, &job_id).state, "failed");
    }
}

#[test]
fn test_interrupted_dry_run_does_not_pause_safe_read_recovery() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = queue
        .enqueue_engagement(
            "ubc",
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "https://www.instagram.com/p/ReadOnlyInspection/",
            None,
            true,
        )
        .unwrap();
    assert_eq!(claim(queue).unwrap().id, job_id);
    let digest_id = digest(queue, "safe-read-recovery").id;
    assert_eq!(claim(queue).unwrap().id, digest_id);
    let reopened = f.reopen();
    reopened.recover_interrupted().unwrap();
    assert!(!paused(&reopened));
    assert_eq!(job(&reopened, &job_id).state, "failed");
    assert_eq!(job(&reopened, &digest_id).state, "pending");
    assert_eq!(claim(&reopened).unwrap().id, digest_id);
}

#[test]
fn test_failed_or_unsupported_engagement_requires_explicit_retry() {
    for result in [None, Some(json!({"status": "unsupported"}))] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = engagement(queue, "Post1");
        assert_eq!(claim(queue).unwrap().id, job_id);
        let error = result
            .is_none()
            .then(|| "Unconfirmed browser result".to_owned());
        queue
            .finish(
                &job(queue, &job_id),
                Finish {
                    result,
                    error,
                    ..Finish::default()
                },
            )
            .unwrap();

        assert_eq!(engagement(queue, "Post1"), job_id);
        assert!(claim(queue).is_none());
        queue.retry(&job_id).unwrap();
        assert_eq!(claim(queue).unwrap().id, job_id);
    }
}

#[test]
fn test_successful_or_running_engagement_cannot_be_retried_or_cancelled() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = engagement(queue, "Post1");
    assert_eq!(claim(queue).unwrap().id, job_id);
    queue.cancel(&job_id).unwrap();
    assert_eq!(job(queue, &job_id).state, "running");
    value_error(queue.retry(&job_id));

    queue.finish(&job(queue, &job_id), succeeded()).unwrap();

    value_error(queue.retry(&job_id));
    assert_eq!(job(queue, &job_id).state, "succeeded");
}

#[test]
fn test_expired_digest_does_not_touch_the_browser_or_block_engagement() {
    let f = fixture();
    let queue = &f.queue;
    let digest_id = digest(queue, "cache-expired").id;
    let engagement_id = engagement(queue, "Post1");

    let next_job = queue
        .claim_next(
            Some(job(queue, &digest_id).created_at + control().result_timeout_seconds + 1.0),
            true,
        )
        .unwrap()
        .unwrap();

    assert_eq!(next_job.id, engagement_id);
    assert_eq!(job(queue, &digest_id).state, "cancelled");
    assert_eq!(digest(queue, "cache-expired").id, digest_id);
    assert_eq!(job(queue, &digest_id).state, "pending");
}

#[test]
fn test_digest_wait_fails_promptly_and_cancels_unusable_pending_job() {
    for worker_state in ["absent", "stale", "paused"] {
        let f = clocked();
        let queue = &f.queue;
        if worker_state != "absent" {
            let heartbeat = if worker_state == "paused" {
                json!(f.clock.now())
            } else {
                json!(0)
            };
            queue
                .set_setting("worker", json!({"running": true, "heartbeat": heartbeat}))
                .unwrap();
        }
        if worker_state == "paused" {
            queue.set_setting("paused", json!(true)).unwrap();
        }
        let job_id = digest(queue, "cache-unavailable").id;

        assert!(
            digest_error(resolve(queue, "cache-unavailable")).contains("unavailable or paused")
        );

        assert_eq!(f.clock.elapsed(), 0.0, "{worker_state}");
        assert_eq!(job(queue, &job_id).state, "cancelled");
    }
}

#[test]
fn test_real_sqlite_busy_claim_waits_then_claims_exactly_once() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = digest(queue, "busy-claim").id;
    overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
    let blocker = Arc::new(Mutex::new(writer(queue)));
    blocker
        .lock()
        .unwrap()
        .execute_batch("BEGIN IMMEDIATE")
        .unwrap();
    let held = blocker.clone();
    f.clock.after_sleep(move || release(&held.lock().unwrap()));

    let claimed = claim(queue).unwrap();

    assert_eq!(claimed.id, job_id);
    assert_eq!(claimed.attempts, 1);
    assert_eq!(
        f.clock.sleeps(),
        vec![control().storage_retry_interval_seconds]
    );
    assert!(claim(queue).is_none());
}

/// Python failed the commit of the matching transaction once with SQLITE_FULL. Here
/// another connection holds the write lock (SQLITE_BUSY, also retried) until the
/// queue's first retry wait, so the whole transaction is retried exactly once.
#[test]
fn test_full_commit_retries_the_transaction_without_duplicating_claim_or_refund() {
    for operation in ["claim", "refund", "completion"] {
        let f = fixture();
        let queue = &f.queue;
        let job_ids: Vec<String> = (0..3)
            .map(|index| digest(queue, &format!("commit-full-{index}")).id)
            .collect();
        let first = claim(queue).unwrap();
        if operation != "claim" {
            queue
                .defer_for_rate_limit(Some(&first), "HTTP 429")
                .unwrap();
        }
        overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
        let blocker = Arc::new(Mutex::new(writer(queue)));
        blocker
            .lock()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE")
            .unwrap();
        let released = Arc::new(AtomicUsize::new(0));
        let (held, count) = (blocker.clone(), released.clone());
        f.clock.after_sleep(move || {
            let held = held.lock().unwrap();
            if !held.is_autocommit() {
                count.fetch_add(1, Ordering::SeqCst);
                release(&held);
            }
        });
        match operation {
            "claim" => {
                let companions = queue.claim_companions(&first, 2, true).unwrap();
                let ids: HashSet<&str> = companions.iter().map(|job| job.id.as_str()).collect();
                let expected: HashSet<&str> = job_ids[1..].iter().map(String::as_str).collect();
                assert_eq!(ids, expected);
                assert!(companions.iter().all(|job| job.attempts == 1));
            }
            "refund" => {
                queue.finish(&first, refund("HTTP 429")).unwrap();
                assert_eq!(job(queue, &first.id).state, "pending");
                assert_eq!(job(queue, &first.id).attempts, 0);
            }
            _ => {
                queue
                    .finish(
                        &first,
                        Finish::result(json!({"status": "succeeded", "items": ["saved"]})),
                    )
                    .unwrap();
                assert_eq!(
                    job(queue, &first.id).result,
                    Some(json!({"status": "succeeded", "items": ["saved"]}))
                );
                assert_eq!(job(queue, &first.id).attempts, 1);
            }
        }
        assert_eq!(released.load(Ordering::SeqCst), 1, "{operation}");
        assert_eq!(
            f.clock.sleeps(),
            vec![control().storage_retry_interval_seconds]
        );
        assert!(!queue.is_storage_unavailable());
    }
}

/// Python failed every `INSERT INTO diagnostic_events`. Here another connection takes
/// the write lock as soon as the job's own transaction has committed (the first clock
/// read it can win), so only the diagnostic write meets SQLITE_BUSY on every attempt.
#[test]
fn test_full_diagnostics_cannot_mask_a_committed_job_or_admit_more_work() {
    let f = fixture();
    let queue = &f.queue;
    overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
    let blocker = Arc::new(Mutex::new(writer(queue)));
    let locked = Arc::new(AtomicBool::new(false));
    let (held, taken) = (blocker.clone(), locked.clone());
    f.clock.on_time(move || {
        if !taken.load(Ordering::SeqCst)
            && held
                .lock()
                .unwrap()
                .execute_batch("BEGIN IMMEDIATE")
                .is_ok()
        {
            taken.store(true, Ordering::SeqCst);
        }
    });

    let job_id = digest(queue, "diagnostic-full").id;

    release(&blocker.lock().unwrap());
    assert!(locked.load(Ordering::SeqCst));
    assert_eq!(job(queue, &job_id).state, "pending");
    assert_eq!(event_count(queue), 0);
    assert_eq!(f.clock.sleeps().len(), control().storage_retry_limit - 1);
    assert!(queue.is_storage_unavailable());
    assert!(claim(queue).is_none());
    assert!(!paused(queue));
    queue.recover_interrupted().unwrap();
    assert_eq!(claim(queue).unwrap().id, job_id);
}

/// Python made `queue.get` raise. Here a trigger leaves the retried row unreadable
/// (`attempts` holds text), so the diagnostic's read of the job fails after the
/// manual transition committed.
#[test]
fn test_failed_diagnostic_read_does_not_repeat_committed_manual_transition() {
    for operation in ["retry", "retry_retrieval"] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = retrieval(queue, "https://www.instagram.com/p/DiagnosticRead/");
        assert_eq!(claim(queue).unwrap().id, job_id);
        queue
            .finish(&job(queue, &job_id), Finish::error("Read failed"))
            .unwrap();
        db(queue)
            .execute_batch(
                "CREATE TRIGGER unreadable_retry AFTER UPDATE OF state ON jobs \
                 WHEN NEW.state='pending' BEGIN \
                 UPDATE jobs SET attempts='private SQL details' WHERE id=NEW.id; END",
            )
            .unwrap();

        match operation {
            "retry" => queue.retry(&job_id).unwrap(),
            _ => queue.retry_retrieval(&job_id).unwrap(),
        }

        storage_error(queue.get(&job_id));
        let state: String = db(queue)
            .query_row("SELECT state FROM jobs WHERE id=?", [&job_id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(state, "pending", "{operation}");
    }
}

/// Python failed `INSERT INTO settings VALUES` on every attempt; another connection
/// holding the write lock fails it the same way (SQLITE_BUSY).
#[test]
fn test_failed_auth_pause_write_stays_in_memory_until_durable_recovery() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = digest(queue, "retain-auth-pause").id;
    claim(queue);
    let reason = "Instagram browser requires human account recovery";
    overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
    let blocker = writer(queue);
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    storage_error(queue.set_setting("paused", json!(reason)));
    assert_eq!(f.clock.sleeps().len(), control().storage_retry_limit - 1);
    release(&blocker);
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(reason)));
    assert!(claim(queue).is_none());
    queue.recover_interrupted().unwrap();
    let reopened = f.reopen();
    assert_eq!(reopened.get_setting("paused").unwrap(), Some(json!(reason)));
    assert_eq!(job(&reopened, &job_id).state, "pending");
    assert!(claim(&reopened).is_none());
}

/// Python's `_connect` raised SQLITE_CORRUPT; a file that is not a database fails
/// the same way (SQLITE_NOTADB), which is not retried either.
#[test]
fn test_corrupt_storage_fails_without_retrying_or_exposing_private_details() {
    let f = fixture();
    let queue = &f.queue;
    for suffix in ["-wal", "-shm"] {
        let mut path = queue.database_path.clone().into_os_string();
        path.push(suffix);
        let _ = std::fs::remove_file(path);
    }
    std::fs::write(&queue.database_path, [b'x'; 4096]).unwrap();

    storage_error(queue.get_setting("worker"));
    assert!(f.clock.sleeps().is_empty());
    assert!(queue.is_storage_unavailable());
}

#[test]
fn test_owned_setup_pause_restores_atomically_without_erasing_a_new_auth_hold() {
    for changed in [false, true] {
        let f = fixture();
        let queue = &f.queue;
        let hold = json!("Installer owns browser bootstrap");
        queue.set_setting("paused", hold.clone()).unwrap();
        let newer = f.reopen();
        if changed {
            newer
                .set_setting(
                    "paused",
                    json!("Instagram browser requires human account recovery"),
                )
                .unwrap();
        }
        assert_eq!(
            queue.compare_set_pause(&hold, &json!(false)).unwrap(),
            !changed
        );
        assert_eq!(
            queue.get_setting("paused").unwrap(),
            Some(if changed {
                json!("Instagram browser requires human account recovery")
            } else {
                json!(false)
            })
        );
    }
}

#[test]
fn test_setup_pause_restore_keeps_a_new_auth_hold_that_could_not_be_written() {
    let f = fixture();
    let queue = &f.queue;
    let hold = json!("Installer owns browser bootstrap");
    queue.set_setting("paused", hold.clone()).unwrap();
    overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
    let blocker = writer(queue);
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    storage_error(queue.set_setting(
        "paused",
        json!("Instagram browser requires human account recovery"),
    ));
    release(&blocker);
    assert!(!queue.compare_set_pause(&hold, &json!(false)).unwrap());
    queue.recover_interrupted().unwrap();
    assert_eq!(
        queue.get_setting("paused").unwrap(),
        Some(json!("Instagram browser requires human account recovery"))
    );
}

#[test]
fn test_pause_can_be_acquired_atomically_before_a_setting_exists() {
    let f = fixture();
    let queue = &f.queue;
    let hold = json!("Installer owns browser bootstrap");
    assert_eq!(
        queue.setting_or("paused", json!(false)).unwrap(),
        json!(false)
    );
    assert!(queue.compare_set_pause(&json!(false), &hold).unwrap());
    assert_eq!(queue.get_setting("paused").unwrap(), Some(hold));
    assert!(claim(queue).is_none());
}

/// Python's `_connect` failed every attempt; here another connection holds the write
/// lock for all of them.
#[test]
fn test_storage_recovery_persists_a_rate_limit_that_could_not_be_written() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = digest(queue, "unstored-rate-limit").id;
    let active = claim(queue).unwrap();
    overrides::instagram_browser(|control| control.storage_busy_timeout_seconds = 0.01);
    let blocker = writer(queue);
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();

    storage_error(queue.defer_for_rate_limit(Some(&active), "HTTP 429"));
    assert!(queue.is_rate_limited(None, false).unwrap());
    // Every attempt failed: one wait between each.
    assert_eq!(f.clock.sleeps().len(), control().storage_retry_limit - 1);
    release(&blocker);
    f.clock.add(10.0);
    queue.recover_interrupted().unwrap();
    assert_eq!(job(queue, &job_id).state, "pending");
    assert!(queue.is_rate_limited(None, false).unwrap());
    assert_eq!(
        setting_f64(queue, "browser_rate_limit_until"),
        Some(f.clock.now() + backoff())
    );
    assert!(claim(queue).is_none());
    assert!(!paused(queue));
}

#[test]
fn test_digest_wait_returns_exact_worker_result() {
    let f = clocked();
    let queue = f.queue.clone();
    queue
        .set_setting(
            "worker",
            json!({"running": true, "heartbeat": f.clock.now()}),
        )
        .unwrap();
    let worker = queue.clone();
    f.clock.after_sleep(move || {
        let job = worker.claim_next(None, true).unwrap().unwrap();
        assert_eq!(job.kind, "digest");
        worker
            .finish(
                &job,
                Finish::result(json!({
                    "account_username": ACCOUNT_USERNAME,
                    "media_ids": ["123", "456"],
                    "page_count": 2,
                })),
            )
            .unwrap();
    });

    let result = resolve(&queue, "cache-succeeded").unwrap();

    assert_eq!(
        result,
        DigestResolution {
            account_username: ACCOUNT_USERNAME.to_owned(),
            media_ids: vec!["123".to_owned(), "456".to_owned()],
            page_count: 2,
        }
    );
    assert_eq!(f.clock.elapsed(), control().worker_poll_interval_seconds);
}

#[test]
fn test_digest_wait_reports_terminal_failure() {
    for terminal_state in ["cancelled", "failed"] {
        let f = clocked();
        let queue = f.queue.clone();
        queue
            .set_setting(
                "worker",
                json!({"running": true, "heartbeat": f.clock.now()}),
            )
            .unwrap();
        let job_id = digest(&queue, "cache-failed").id;
        let (worker, id) = (queue.clone(), job_id.clone());
        f.clock.after_sleep(move || {
            if terminal_state == "cancelled" {
                worker.cancel(&id).unwrap();
            } else {
                assert_eq!(claim(&worker).unwrap().id, id);
                worker
                    .finish(
                        &job(&worker, &id),
                        Finish::error("Instagram requires human reauthorization"),
                    )
                    .unwrap();
            }
        });

        let message = digest_error(resolve(&queue, "cache-failed"));
        assert!(message.contains("cancelled") || message.contains("reauthorization"));

        assert_eq!(job(&queue, &job_id).state, terminal_state);
    }
}

/// Python made `enqueue_digest`, `get` or `get_setting` raise `sqlite3.OperationalError`.
/// Here a trigger refuses the insert, a corrupted row breaks the job read once the
/// submission returned, and a stored blob breaks the worker setting read.
#[test]
fn test_digest_storage_failures_preserve_sanitized_error_contract() {
    for failing_method in ["enqueue_digest", "get", "get_setting"] {
        let f = clocked();
        let queue = f.queue.clone();
        match failing_method {
            "enqueue_digest" => db(&queue)
                .execute_batch(
                    "CREATE TRIGGER refuse_jobs BEFORE INSERT ON jobs BEGIN \
                     SELECT RAISE(ABORT, 'private filesystem error'); END",
                )
                .unwrap(),
            "get" => {
                let path = queue.database_path.clone();
                f.clock.on_monotonic(move || {
                    Connection::open(&path)
                        .unwrap()
                        .execute_batch("UPDATE jobs SET attempts='private filesystem error'")
                        .unwrap();
                });
            }
            _ => db(&queue)
                .execute_batch("INSERT INTO settings VALUES ('worker', x'7b7d')")
                .unwrap(),
        }

        let message = digest_error(resolve(&queue, "cache-storage-error"));

        assert!(
            !message.contains("private filesystem error"),
            "{failing_method}"
        );
        assert!(
            message == "Could not enqueue Instagram digest"
                || message == "Instagram browser queue storage is unavailable",
            "{failing_method}: {message}"
        );
    }
}

#[test]
fn test_concurrent_threads_deduplicate_submissions_and_claim_each_job_once() {
    let f = fixture();
    let next = AtomicUsize::new(0);
    let submitted = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    if index >= 20 {
                        break;
                    }
                    let client = f.reopen();
                    let pair = (
                        engagement(&client, "Shared"),
                        engagement(&client, &format!("Unique{index}")),
                    );
                    submitted.lock().unwrap().push(pair);
                }
            });
        }
    });
    let submitted = submitted.into_inner().unwrap();

    let shared_ids: HashSet<String> = submitted.iter().map(|item| item.0.clone()).collect();
    let mut expected_ids = shared_ids.clone();
    expected_ids.extend(submitted.iter().map(|item| item.1.clone()));
    assert_eq!(shared_ids.len(), 1);
    assert_eq!(expected_ids.len(), 21);

    let next = AtomicUsize::new(0);
    let claimed = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                while next.fetch_add(1, Ordering::SeqCst) < 28 {
                    if let Some(job) = claim(&f.queue) {
                        claimed.lock().unwrap().push(job.id);
                    }
                }
            });
        }
    });
    let actual_ids = claimed.into_inner().unwrap();
    let unique: HashSet<String> = actual_ids.iter().cloned().collect();
    assert_eq!(actual_ids.len(), 21);
    assert_eq!(unique.len(), 21);
    assert_eq!(unique, expected_ids);
}

/// Python started four interpreter processes. Here four threads each open their own
/// queue (separate SQLite connections), which shares the same file locking.
#[test]
fn test_independent_processes_share_deduplication_and_atomic_claims() {
    let f = fixture();
    let outputs = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for index in 0..4 {
            let (f, outputs) = (&f, &outputs);
            scope.spawn(move || {
                let queue = f.reopen();
                let shared = engagement_in(&queue, "Shared", "ubc", 1);
                let unique = engagement_in(&queue, &format!("Child{index}"), "ubc", 1);
                let claimed = claim(&queue).map(|job| job.id);
                outputs.lock().unwrap().push((shared, unique, claimed));
            });
        }
    });
    let outputs = outputs.into_inner().unwrap();

    let shared_ids: HashSet<String> = outputs.iter().map(|output| output.0.clone()).collect();
    let mut expected_ids = shared_ids.clone();
    expected_ids.extend(outputs.iter().map(|output| output.1.clone()));
    let mut claimed_ids: Vec<String> = outputs
        .iter()
        .filter_map(|output| output.2.clone())
        .collect();
    assert_eq!(shared_ids.len(), 1);
    assert_eq!(expected_ids.len(), 5);
    while let Some(job) = claim(&f.queue) {
        claimed_ids.push(job.id);
    }
    let unique: HashSet<String> = claimed_ids.iter().cloned().collect();
    assert_eq!(unique, expected_ids);
    assert_eq!(claimed_ids.len(), unique.len());
}

#[test]
fn test_digest_preempts_retrieval_and_retrieval_preempts_engagement() {
    let f = fixture();
    let queue = &f.queue;
    let engagement = engagement(queue, "Post1");
    let retrieval = retrieval(queue, "https://www.instagram.com/p/AbC/");
    let digest = digest(queue, "cache-first").id;
    assert_eq!(complete_next(queue, true).unwrap().id, digest);
    assert_eq!(complete_next(queue, false).unwrap().id, retrieval);
    assert_eq!(complete_next(queue, true).unwrap().id, engagement);
}

#[test]
fn test_aged_engagement_drains_retrieval_before_switching_but_digest_stays_first() {
    let f = clocked();
    let queue = &f.queue;
    let first = retrieval(queue, "https://www.instagram.com/p/Running/");
    let running = claim(queue).unwrap();
    let engagement = engagement(queue, "Post1");
    let remaining = retrieval(queue, "https://www.instagram.com/p/Remaining/");
    f.clock.add(control().engagement_max_wait_seconds);
    assert!(
        queue
            .claim_companions(&running, 14, true)
            .unwrap()
            .is_empty()
    );
    assert_eq!(job(queue, &first).state, "running");
    assert_eq!(job(queue, &remaining).state, "pending");
    queue
        .finish(&job(queue, &first), Finish::result(json!({"posts": []})))
        .unwrap();
    let digest = digest(queue, "still-highest-priority").id;
    assert_eq!(complete_next(queue, true).unwrap().id, digest);
    assert_eq!(complete_next(queue, true).unwrap().id, engagement);
    assert_eq!(complete_next(queue, true).unwrap().id, remaining);
}

#[test]
fn test_ineligible_engagement_does_not_interrupt_continuous_retrieval() {
    for reason in ["young", "cooldown", "excluded", "disabled"] {
        let f = clocked();
        let queue = &f.queue;
        retrieval(queue, "https://www.instagram.com/p/Running/");
        let first = claim(queue).unwrap();
        let engagement = queue
            .enqueue_engagement(
                "uwo",
                "456",
                "wat2do.uwo",
                "https://www.instagram.com/p/Featured/",
                None,
                false,
            )
            .unwrap();
        let remaining = retrieval(queue, "https://www.instagram.com/p/Refill/");
        if reason != "young" {
            f.clock.add(control().engagement_max_wait_seconds);
        }
        if reason == "cooldown" {
            queue
                .set_setting("next_engagement_at", json!(f.clock.now() + 100.0))
                .unwrap();
        }
        if reason == "excluded" {
            queue
                .set_setting("excluded_accounts", json!(["wat2do.uwo"]))
                .unwrap();
        }
        let companions = queue
            .claim_companions(&first, 14, reason != "disabled")
            .unwrap();
        let ids: Vec<&str> = companions.iter().map(|job| job.id.as_str()).collect();
        assert_eq!(ids, [remaining.as_str()], "{reason}");
        assert_eq!(job(queue, &engagement).state, "pending");
    }
}

#[test]
fn test_overdue_backlog_yields_retrieval_but_finishes_current_school_before_switching() {
    let f = clocked();
    let queue = &f.queue;
    let initial = engagement(queue, "InitialUBC");
    assert_eq!(complete_next(queue, true).unwrap().id, initial);
    assert_eq!(
        queue.get_setting("engagement_school").unwrap(),
        Some(json!("ubc"))
    );
    f.clock.add(1.0);
    let older_other_school = queue
        .enqueue_engagement(
            "uwo",
            "456",
            "wat2do.uwo",
            "https://www.instagram.com/p/OlderUWO/",
            None,
            false,
        )
        .unwrap();
    f.clock.add(1.0);
    let second_current_school = engagement(queue, "SecondUBC");
    f.clock.add(1.0);
    let third_current_school = engagement(queue, "ThirdUBC");
    let first_read = retrieval(queue, "https://www.instagram.com/p/ActiveRetrieval/");
    let active = claim(queue).unwrap();
    assert_eq!(active.id, first_read);
    let remaining_read = retrieval(queue, "https://www.instagram.com/p/RemainingRetrieval/");
    f.clock.add(control().engagement_max_wait_seconds);
    assert!(
        queue
            .claim_companions(&active, 14, true)
            .unwrap()
            .is_empty()
    );
    queue
        .finish(
            &job(queue, &first_read),
            Finish::result(json!({"posts": []})),
        )
        .unwrap();
    assert_eq!(
        complete_next(queue, true).unwrap().id,
        second_current_school
    );
    assert_eq!(complete_next(queue, true).unwrap().id, third_current_school);
    assert_eq!(complete_next(queue, true).unwrap().id, older_other_school);
    assert_eq!(complete_next(queue, true).unwrap().id, remaining_read);
}

#[test]
fn test_safe_read_retry_preserves_diagnostic_reason_without_exposing_terminal_failure() {
    for kind in ["digest", "retrieval"] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = if kind == "digest" {
            digest(queue, "read-retry").id
        } else {
            retrieval(queue, "https://www.instagram.com/p/ReadRetry/")
        };
        claim(queue);
        queue
            .finish(
                &job(queue, &job_id),
                Finish {
                    result: Some(json!({"private_details": "must-not-be-logged"})),
                    ..requeue("Transient bridge failure")
                },
            )
            .unwrap();
        let retried = job(queue, &job_id);
        assert_eq!(retried.state, "pending");
        assert_eq!(retried.error, None);
        assert_eq!(retried.result, None);
        assert_eq!(retried.attempts, 1);
        queue.record_diagnostic("pending", Some(&retried), None);
        assert_eq!(started_at(queue, &job_id), None);
        let events = events(queue);
        let reasons: Vec<(Value, Value)> = events
            .iter()
            .map(|event| {
                (
                    event["payload"]["state"].clone(),
                    event["payload"]["reason"].clone(),
                )
            })
            .collect();
        assert_eq!(
            reasons,
            [
                (json!("queued"), Value::Null),
                (json!("retrying"), json!("Transient bridge failure")),
                (json!("pending"), Value::Null),
            ]
        );
        assert_eq!(events[1]["payload"]["job_id"], json!(job_id));
        assert_eq!(events[1]["payload"]["kind"], json!(kind));
        assert_eq!(events[1]["ig_account"], ACCOUNT_USERNAME);
        assert_eq!(
            events[1]["post_url"],
            if kind == "retrieval" {
                json!("https://www.instagram.com/p/ReadRetry/")
            } else {
                Value::Null
            }
        );
        let keys: HashSet<&str> = events[1]["payload"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            HashSet::from(["state", "job_id", "kind", "reason", "recorded_at"])
        );
        assert!(!pyjson::dumps(&events[1], None).contains("must-not-be-logged"));
        assert_eq!(claim(queue).unwrap().attempts, 2);
    }
}

#[test]
fn test_confirmed_rate_limit_preserves_last_read_attempt_budget_and_claim_diagnostics() {
    for kind in ["digest", "retrieval"] {
        let f = clocked();
        let queue = &f.queue;
        let job_id = if kind == "digest" {
            digest(queue, "rate-limit-last-budget").id
        } else {
            retrieval(queue, "https://www.instagram.com/p/RateLastBudget/")
        };
        let limit = control().ingestion_retry_limit;
        db(queue)
            .execute(
                "UPDATE jobs SET attempts=? WHERE id=?",
                params![limit - 1, job_id],
            )
            .unwrap();
        let active = claim(queue).unwrap();
        assert_eq!(active.attempts, limit);
        queue.record_diagnostic("running", Some(&active), None);
        let reason = "Instagram public media request failed with HTTP 429";
        queue.defer_for_rate_limit(Some(&active), reason).unwrap();

        queue.finish(&active, refund(reason)).unwrap();

        let held = job(queue, &job_id);
        assert_eq!(held.state, "pending");
        assert_eq!(held.attempts, limit - 1);
        assert_eq!(held.error, None);
        assert!(claim(queue).is_none());
        assert_eq!(started_at(queue, &job_id), None);
        let reasons: Vec<(Value, Value)> = events(queue)
            .iter()
            .map(|event| {
                (
                    event["payload"]["state"].clone(),
                    event["payload"]["reason"].clone(),
                )
            })
            .collect();
        assert_eq!(
            reasons,
            [
                (json!("queued"), Value::Null),
                (json!("running"), Value::Null),
                (json!("rate_limited"), json!(reason)),
                (json!("retrying"), json!(reason)),
            ]
        );
        f.clock.add(backoff());
        let retried = claim(queue).unwrap();
        assert_eq!(retried.id, job_id);
        assert_eq!(retried.attempts, limit);
        queue
            .finish(
                &job(queue, &job_id),
                Finish::error("Instagram public media request failed with HTTP 400"),
            )
            .unwrap();
        assert_eq!(job(queue, &job_id).state, "failed");
        assert_eq!(job(queue, &job_id).attempts, limit);
    }
}

#[test]
fn test_rate_limit_attempt_refund_requires_a_requeued_read() {
    for (requeue, kind) in [(false, "digest"), (true, "engagement")] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = if kind == "digest" {
            digest(queue, "rate-limit-refund-guard").id
        } else {
            engagement(queue, "RateRefundNative")
        };
        let active = claim(queue).unwrap();
        let events = raw_events(queue);

        value_error(queue.finish(
            &active,
            Finish {
                error: Some("HTTP 429".to_owned()),
                requeue,
                refund_rate_limit: true,
                ..Finish::default()
            },
        ));

        assert_eq!(job(queue, &job_id), active);
        assert_eq!(raw_events(queue), events);
    }
}

#[test]
fn test_rate_limit_attempt_refund_requires_nonempty_error_and_no_result() {
    for (error, result) in [
        (None, None),
        (Some(""), None),
        (Some("   "), None),
        (Some("HTTP 429"), Some(json!({}))),
        (Some("HTTP 429"), Some(json!({"status": "failed"}))),
    ] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = digest(queue, "rate-limit-refund-result").id;
        let active = claim(queue).unwrap();

        let message = value_error(queue.finish(
            &active,
            Finish {
                error: error.map(str::to_owned),
                result,
                requeue: true,
                refund_rate_limit: true,
            },
        ));
        assert!(message.contains("rate-limited claim refund"));

        assert_eq!(job(queue, &job_id), active);
    }
}

#[test]
fn test_rate_limit_attempt_refund_requires_the_original_running_read_claim() {
    for change in ["kind", "state", "started_at", "attempts"] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = digest(queue, "rate-limit-refund-identity").id;
        let active = claim(queue).unwrap();
        let mut changed = active.clone();
        match change {
            "kind" => changed.kind = "engagement".to_owned(),
            "state" => changed.state = "pending".to_owned(),
            "started_at" => changed.started_at = None,
            _ => changed.attempts = 0,
        }

        let message = value_error(queue.finish(&changed, refund("HTTP 429")));
        assert!(message.contains("rate-limited claim refund"), "{change}");

        assert_eq!(job(queue, &job_id), active);
    }
}

#[test]
fn test_simultaneous_rate_limited_completions_refund_only_one_claim() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = digest(queue, "rate-limit-refund-concurrent").id;
    let active = claim(queue).unwrap();
    queue.record_diagnostic("running", Some(&active), None);
    queue
        .defer_for_rate_limit(Some(&active), "HTTP 429")
        .unwrap();

    std::thread::scope(|scope| {
        for _ in 0..14 {
            scope.spawn(|| queue.finish(&active, refund("HTTP 429")).unwrap());
        }
    });

    assert_eq!(job(queue, &job_id).state, "pending");
    assert_eq!(job(queue, &job_id).attempts, 0);
    let states: Vec<Value> = events(queue)
        .iter()
        .map(|event| event["payload"]["state"].clone())
        .collect();
    assert_eq!(
        states,
        [
            json!("queued"),
            json!("running"),
            json!("rate_limited"),
            json!("retrying")
        ]
    );
}

#[test]
fn test_old_rate_limited_claim_cannot_refund_or_defer_a_new_claim_with_same_attempt_number() {
    let f = clocked();
    let queue = &f.queue;
    let job_id = digest(queue, "rate-limit-refund-stale").id;
    let original = claim(queue).unwrap();
    queue
        .defer_for_rate_limit(Some(&original), "HTTP 429")
        .unwrap();
    queue.finish(&original, refund("HTTP 429")).unwrap();
    f.clock.add(backoff());
    let current = claim(queue).unwrap();
    assert_eq!(current.attempts, original.attempts);
    assert_ne!(current.started_at, original.started_at);
    let events = raw_events(queue);

    queue
        .defer_for_rate_limit(Some(&original), "HTTP 429")
        .unwrap();
    queue.finish(&original, refund("HTTP 429")).unwrap();

    assert_eq!(job(queue, &job_id), current);
    assert!(!queue.is_rate_limited(None, false).unwrap());
    assert_eq!(raw_events(queue), events);
    queue
        .defer_for_rate_limit(Some(&current), "HTTP 429")
        .unwrap();
    queue.finish(&current, refund("HTTP 429")).unwrap();
    assert_eq!(job(queue, &job_id).attempts, 0);
}

#[test]
fn test_noop_safe_read_requeue_does_not_record_retry_diagnostics() {
    for rate_limited in [false, true] {
        for state in ["missing", "pending", "succeeded", "failed", "cancelled"] {
            let f = fixture();
            let queue = &f.queue;
            let mut job_id = digest(queue, "no-retry").id;
            let mut original = claim(queue).unwrap();
            assert_eq!(original.id, job_id);
            if state == "missing" {
                job_id = "missing-read".to_owned();
                original.id = job_id.clone();
            }
            match state {
                "succeeded" => queue
                    .finish(&job(queue, &job_id), Finish::default())
                    .unwrap(),
                "failed" => queue
                    .finish(&job(queue, &job_id), Finish::error("Previous failure"))
                    .unwrap(),
                "pending" | "cancelled" => {
                    queue
                        .finish(&job(queue, &job_id), requeue("Previous transient failure"))
                        .unwrap();
                    if state == "cancelled" {
                        queue.cancel(&job_id).unwrap();
                    }
                }
                _ => {}
            }
            let events = raw_events(queue);
            queue
                .finish(
                    &original,
                    Finish {
                        refund_rate_limit: rate_limited,
                        ..requeue("Transient bridge failure")
                    },
                )
                .unwrap();
            let stored = queue.get(&job_id).unwrap();
            if state == "missing" {
                assert!(stored.is_none());
            } else {
                assert_eq!(stored.unwrap().state, state);
            }
            assert_eq!(raw_events(queue), events, "{state} {rate_limited}");
        }
    }
}

#[test]
fn test_automatic_retry_cannot_repeat_an_engagement() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = engagement(queue, "Post1");
    claim(queue);
    assert!(
        value_error(queue.finish(&job(queue, &job_id), requeue("Uncertain click")))
            .contains("Engagement cannot")
    );
    assert_eq!(job(queue, &job_id).state, "running");
    assert_eq!(event_count(queue), 1);
}

#[test]
fn test_paused_queue_does_not_claim_even_when_worker_observed_resume_earlier() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = engagement(queue, "Post1");
    queue
        .set_setting("paused", json!("Human account recovery"))
        .unwrap();
    assert!(claim(queue).is_none());
    assert_eq!(job(queue, &job_id).state, "pending");
}

#[test]
fn test_public_bootstrap_account_is_peeked_without_claiming_or_unexcluding_jobs() {
    let f = fixture();
    let queue = &f.queue;
    assert_eq!(queue.peek_account_username().unwrap(), None);
    let excluded = engagement(queue, "ExcludedProfile");
    queue
        .set_setting("excluded_accounts", json!([ACCOUNT_USERNAME]))
        .unwrap();
    let available = queue
        .enqueue_digest("456", "wat2do.uwo", "bootstrap-public-profile")
        .unwrap()
        .id;
    assert_eq!(
        queue.peek_account_username().unwrap().as_deref(),
        Some("wat2do.uwo")
    );
    assert_eq!(job(queue, &excluded).state, "pending");
    assert_eq!(job(queue, &available).state, "pending");
    assert_eq!(job(queue, &excluded).attempts, 0);
    assert_eq!(job(queue, &available).attempts, 0);
}

#[test]
fn test_diagnostic_publishing_stops_between_http_calls_without_losing_unsent_events() {
    let f = fixture();
    let queue = &f.queue;
    queue.record_diagnostic("first", None, None);
    queue.record_diagnostic("second", None, None);
    let calls = RefCell::new(Vec::new());
    queue
        .publish_diagnostics(
            || !calls.borrow().is_empty(),
            |event| {
                calls.borrow_mut().push(event.clone());
                true
            },
        )
        .unwrap();
    assert_eq!(calls.borrow().len(), 1);
    queue
        .publish_diagnostics(
            || false,
            |event| {
                calls.borrow_mut().push(event.clone());
                true
            },
        )
        .unwrap();
    let calls = calls.into_inner();
    assert_eq!(calls.len(), 2);
    let states: HashSet<&str> = calls
        .iter()
        .map(|event| event["payload"]["state"].as_str().unwrap())
        .collect();
    assert_eq!(states, HashSet::from(["first", "second"]));
}

#[test]
fn test_retrieval_recovery_and_refresh_preserve_other_history() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = retrieval(queue, "https://www.instagram.com/Club.Name/");
    assert_eq!(claim(queue).unwrap().id, job_id);
    queue.recover_interrupted().unwrap();
    assert_eq!(job(queue, &job_id).state, "pending");
    assert!(!paused(queue));
    assert_eq!(claim(queue).unwrap().id, job_id);
    queue
        .finish(&job(queue, &job_id), Finish::result(json!({"posts": []})))
        .unwrap();
    queue.retry_retrieval(&job_id).unwrap();
    assert_eq!(job(queue, &job_id).result, None);
    assert_eq!(job(queue, &job_id).attempts, 0);
    assert_eq!(
        job(queue, &job_id).payload["url"],
        "https://www.instagram.com/club.name/"
    );
}

#[test]
fn test_old_queue_upgrade_keeps_jobs_settings_and_selected_school() {
    for legacy_kinds in [
        "'digest', 'engagement'",
        "'digest', 'RETRIEVAL', 'engagement'",
    ] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = engagement(queue, "Post1");
        queue
            .set_setting("important", json!({"checkpoint": 7}))
            .unwrap();
        claim(queue);
        queue.finish(&job(queue, &job_id), succeeded()).unwrap();
        // Reproduce the deployed schema rather than starting with a new queue.
        {
            let connection = db(queue);
            connection
                .execute_batch("PRAGMA writable_schema=ON")
                .unwrap();
            connection
                .execute(
                    "UPDATE sqlite_master SET sql=replace(sql, ?, ?) WHERE name='jobs'",
                    ["'digest', 'retrieval', 'engagement'", legacy_kinds],
                )
                .unwrap();
            connection
                .execute_batch("PRAGMA writable_schema=OFF")
                .unwrap();
        }
        let reopened = f.reopen();
        assert_eq!(job(&reopened, &job_id).state, "succeeded");
        assert_eq!(
            reopened.get_setting("important").unwrap(),
            Some(json!({"checkpoint": 7}))
        );
        reopened
            .enqueue_retrieval(
                "ubc",
                RECIPIENT_ID,
                ACCOUNT_USERNAME,
                "https://www.instagram.com/p/AbC/",
                1,
            )
            .unwrap();
        assert_eq!(
            reopened.get_setting("engagement_school").unwrap(),
            Some(json!("ubc")),
            "{legacy_kinds}"
        );
    }
}

#[test]
fn test_digest_companions_never_cross_accounts_or_include_excluded_targets() {
    let f = fixture();
    let q = &f.queue;
    let first = q.enqueue_digest("123", "wat2do.ubc", "first").unwrap().id;
    let same = q.enqueue_digest("123", "wat2do.ubc", "second").unwrap().id;
    let other = q.enqueue_digest("456", "wat2do.utm", "third").unwrap().id;
    let excluded = q.enqueue_digest("789", "wat2do.utsc", "fourth").unwrap().id;
    q.set_setting("excluded_accounts", json!(["wat2do.utsc"]))
        .unwrap();
    let claimed = claim(q).unwrap();
    assert_eq!(claimed.id, first);
    let companions: Vec<String> = q
        .claim_companions(&claimed, 9, true)
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(companions, [same.as_str()]);
    assert_eq!(job(q, &same).attempts, 1);
    assert_eq!(job(q, &other).state, "pending");
    assert_eq!(job(q, &excluded).state, "pending");
}

#[test]
fn test_waiting_digest_and_pause_prevent_filling_retrieval_batch() {
    let f = fixture();
    let q = &f.queue;
    let first = q
        .enqueue_retrieval(
            "ubc",
            "123",
            "wat2do.ubc",
            "https://www.instagram.com/p/First/",
            1,
        )
        .unwrap();
    let second = q
        .enqueue_retrieval(
            "ubc",
            "123",
            "wat2do.ubc",
            "https://www.instagram.com/p/Second/",
            1,
        )
        .unwrap();
    let claimed = claim(q).unwrap();
    assert_eq!(claimed.id, first);
    let digest = q.enqueue_digest("123", "wat2do.ubc", "digest").unwrap().id;
    assert!(q.claim_companions(&claimed, 9, true).unwrap().is_empty());
    q.cancel(&digest).unwrap();
    q.set_setting("paused", json!("human recovery")).unwrap();
    assert!(q.claim_companions(&claimed, 9, true).unwrap().is_empty());
    assert_eq!(job(q, &second).state, "pending");
}

#[test]
fn test_diagnostics_preserve_unsent_events_and_allowlist_payload() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = engagement(queue, "Post1");
    let claimed = claim(queue).unwrap();
    queue.record_diagnostic("running", Some(&claimed), None);
    queue
        .finish(
            &job(queue, &job_id),
            Finish::error("Matching Instagram browser account is unavailable"),
        )
        .unwrap();
    queue.record_diagnostic("failed", Some(&job(queue, &job_id)), None);
    queue
        .set_setting(
            "paused",
            json!("Instagram browser requires human account recovery"),
        )
        .unwrap();
    queue.publish_diagnostics(|| false, |_| false).unwrap();
    assert_eq!(event_count(queue), 4);
    let mut events = Vec::new();
    queue
        .publish_diagnostics(
            || false,
            |event| {
                events.push(event.clone());
                true
            },
        )
        .unwrap();
    let states: Vec<&str> = events
        .iter()
        .map(|event| event["payload"]["state"].as_str().unwrap())
        .collect();
    assert_eq!(states, ["queued", "running", "failed", "paused"]);
    assert_eq!(events[0]["payload"]["job_id"], json!(job_id));
    assert_eq!(events[0]["sender_id"], "instagram-browser-worker");
    assert!(events[0]["payload"].get("recipient_id").is_none());
    assert!(events[0]["payload"].get("payload").is_none());
    assert_eq!(event_count(queue), 0);
}

#[test]
fn test_deduplicated_queueing_does_not_duplicate_diagnostics() {
    let f = fixture();
    let queue = &f.queue;
    assert_eq!(engagement(queue, "Post1"), engagement(queue, "Post1"));
    assert_eq!(event_count(queue), 1);
}

#[test]
fn test_digest_waits_through_installer_pause_and_worker_restart() {
    let f = clocked();
    let queue = f.queue.clone();
    queue
        .set_setting("paused", json!(WORKER_INSTALLATION_PAUSE))
        .unwrap();
    queue
        .set_setting(
            "worker",
            json!({"running": true, "heartbeat": f.clock.now()}),
        )
        .unwrap();
    let sleeps = Arc::new(Mutex::new(Vec::new()));
    let (worker, clock, seen) = (queue.clone(), f.clock.clone(), sleeps.clone());
    f.clock.after_sleep(move || {
        assert_eq!(
            worker.get_setting("paused").unwrap(),
            Some(json!(WORKER_INSTALLATION_PAUSE))
        );
        assert!(claim(&worker).is_none());
        let mut seen = seen.lock().unwrap();
        seen.push(clock.elapsed());
        if seen.len() == 1 {
            worker
                .set_setting("worker", json!({"running": false, "heartbeat": 0}))
                .unwrap();
            return;
        }
        worker
            .set_setting("worker", json!({"running": true, "heartbeat": clock.now()}))
            .unwrap();
        assert!(
            worker
                .compare_set_pause(&json!(WORKER_INSTALLATION_PAUSE), &json!(false))
                .unwrap()
        );
        worker
            .finish(&claim(&worker).unwrap(), Finish::result(digest_result()))
            .unwrap();
    });
    let result = resolve(&queue, "install-restart").unwrap();
    assert_eq!(result.media_ids, ["123"]);
    assert_eq!(sleeps.lock().unwrap().len(), 2);
    assert_eq!(
        f.clock.elapsed(),
        2.0 * control().worker_poll_interval_seconds
    );
    assert!(!paused(&queue));
}

#[test]
fn test_installer_pause_waits_only_to_original_digest_deadline() {
    for replaced in [false, true] {
        let f = clocked();
        let queue = f.queue.clone();
        let receipt = digest(&queue, "install-expiry");
        queue
            .set_setting("paused", json!(WORKER_INSTALLATION_PAUSE))
            .unwrap();
        queue
            .set_setting("worker", json!({"running": false, "heartbeat": 0}))
            .unwrap();
        let newer = Arc::new(Mutex::new(Vec::new()));
        let (submitter, receipt_id, replacements) =
            (queue.clone(), receipt.id.clone(), newer.clone());
        f.clock.after_sleep(move || {
            let mut replacements = replacements.lock().unwrap();
            if replaced && replacements.is_empty() {
                submitter.cancel(&receipt_id).unwrap();
                replacements.push(digest(&submitter, "install-expiry"));
            }
        });
        assert!(digest_error(resolve(&queue, "install-expiry")).contains("timed out"));
        assert_eq!(f.clock.elapsed(), control().result_timeout_seconds);
        assert_eq!(
            queue.get_setting("paused").unwrap(),
            Some(json!(WORKER_INSTALLATION_PAUSE))
        );
        assert!(claim(&queue).is_none());
        let newer = newer.lock().unwrap();
        if replaced {
            assert_eq!(job(&queue, &receipt.id), newer[0]);
            assert_eq!(newer[0].state, "pending");
        } else {
            assert_eq!(job(&queue, &receipt.id).state, "cancelled");
        }
    }
}

#[test]
fn test_digest_waits_only_for_exact_installer_hold_and_never_auth_holds() {
    let installer_with_auth = format!("{WORKER_INSTALLATION_PAUSE}; human account recovery");
    for pause in [
        "Instagram browser requires human account recovery",
        "Instagram browser request cancellation could not be confirmed: Apple Event -600",
        installer_with_auth.as_str(),
    ] {
        let f = clocked();
        let queue = &f.queue;
        let receipt = digest(queue, "auth-during-install");
        queue.set_setting("paused", json!(pause)).unwrap();
        queue
            .set_setting("worker", json!({"running": false, "heartbeat": 0}))
            .unwrap();
        let message = digest_error(resolve(queue, "auth-during-install"));
        assert!(message.contains("worker is paused"));
        assert_eq!(f.clock.elapsed(), 0.0);
        assert!(message.contains(pause));
        assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(pause)));
        assert_eq!(job(queue, &receipt.id).state, "cancelled");
        assert_eq!(job(queue, &receipt.id).attempts, 0);
    }
}

#[test]
fn test_old_completion_cannot_change_a_new_running_read_claim() {
    for outcome in ["success", "failure", "requeue", "missing"] {
        let f = fixture();
        let queue = &f.queue;
        let job_id = retrieval(queue, "https://www.instagram.com/p/OriginalClaim/");
        let mut original = queue.claim_next(Some(100.0), true).unwrap().unwrap();
        queue
            .finish(&original, requeue("Temporary read failure"))
            .unwrap();
        let current = queue.claim_next(Some(200.0), true).unwrap().unwrap();
        if outcome == "missing" {
            original.id = "missing-claim".to_owned();
        }
        let diagnostics = raw_events(queue);
        queue
            .finish(
                &original,
                Finish {
                    result: (outcome == "success")
                        .then(|| json!({"status": "succeeded", "from": "old claim"})),
                    error: (outcome != "success").then(|| "Old read failed".to_owned()),
                    requeue: outcome == "requeue",
                    refund_rate_limit: false,
                },
            )
            .unwrap();
        assert_eq!(job(queue, &job_id), current, "{outcome}");
        assert_eq!(raw_events(queue), diagnostics);
    }
}

#[test]
fn test_digest_caller_can_cancel_pending_retry_with_original_admission() {
    for refund_rate_limit in [false, true] {
        let f = clocked();
        let queue = &f.queue;
        let receipt = digest(queue, "retry-cancellation");
        f.clock.add(10.0);
        let claimed = claim(queue).unwrap();
        assert!(!queue.cancel_pending_digest(&receipt).unwrap());
        f.clock.add(30.0);
        queue
            .finish(
                &claimed,
                Finish {
                    refund_rate_limit,
                    ..requeue("Temporary read failure")
                },
            )
            .unwrap();
        let retry = job(queue, &receipt.id);
        assert_eq!(retry.created_at, receipt.created_at);
        assert_eq!(retry.attempts, if refund_rate_limit { 0 } else { 1 });
        assert_eq!(retry.started_at, None);
        assert!(queue.cancel_pending_digest(&receipt).unwrap());
        assert_eq!(job(queue, &receipt.id).state, "cancelled");
    }
}

#[test]
fn test_automatic_digest_retry_expires_at_original_admission_deadline() {
    for refund_rate_limit in [false, true] {
        for deadline_offset in [0.0, 1.0] {
            let f = clocked();
            let queue = &f.queue;
            let receipt = digest(queue, "retry-expiry");
            f.clock.add(10.0);
            let claimed = claim(queue).unwrap();
            f.clock.add(30.0);
            queue
                .finish(
                    &claimed,
                    Finish {
                        refund_rate_limit,
                        ..requeue("Temporary read failure")
                    },
                )
                .unwrap();
            f.clock
                .set_now(receipt.created_at + control().result_timeout_seconds + deadline_offset);
            assert!(claim(queue).is_none());
            let expired = job(queue, &receipt.id);
            assert_eq!(expired.created_at, receipt.created_at);
            assert_eq!(expired.state, "cancelled");
            assert_eq!(
                expired.error.as_deref(),
                Some("Digest caller deadline expired")
            );
        }
    }
}

#[test]
fn test_rate_limit_cooldown_does_not_renew_digest_caller_lifetime() {
    let f = clocked();
    let queue = &f.queue;
    let receipt = digest(queue, "cooldown-expiry");
    f.clock
        .set_now(receipt.created_at + control().result_timeout_seconds - 10.0);
    let claimed = claim(queue).unwrap();
    queue
        .defer_for_rate_limit(Some(&claimed), "Instagram rate limit")
        .unwrap();
    queue
        .finish(&claimed, refund("Instagram rate limit"))
        .unwrap();
    assert!(claim(queue).is_none());
    f.clock
        .set_now(setting_f64(queue, "browser_rate_limit_until").unwrap());
    assert!(f.clock.now() > receipt.created_at + control().result_timeout_seconds);
    assert!(claim(queue).is_none());
    let expired = job(queue, &receipt.id);
    assert_eq!(expired.created_at, receipt.created_at);
    assert_eq!(expired.state, "cancelled");
    assert_eq!(expired.attempts, 0);
    assert!(!paused(queue));
}

#[test]
fn test_explicit_digest_resubmission_renews_admission_and_fences_original_caller() {
    for terminal_state in ["failed", "cancelled"] {
        let f = clocked();
        let queue = &f.queue;
        let receipt = digest(queue, "new-admission");
        if terminal_state == "failed" {
            queue
                .finish(&claim(queue).unwrap(), Finish::error("Read failure"))
                .unwrap();
        } else {
            queue.cancel(&receipt.id).unwrap();
        }
        f.clock.add(control().result_timeout_seconds + 1.0);
        let current = digest(queue, "new-admission");
        assert_eq!(current.id, receipt.id);
        assert_eq!(current.created_at, f.clock.now());
        assert_eq!(current.attempts, 0);
        assert!(!queue.cancel_pending_digest(&receipt).unwrap());
        assert_eq!(job(queue, &current.id), current);
        assert_eq!(claim(queue).unwrap().id, current.id);
    }
}

#[test]
fn test_digest_companions_expire_old_admissions_before_claiming_fresh_work() {
    let f = clocked();
    let queue = &f.queue;
    let first = digest(queue, "first-running");
    let claimed = claim(queue).unwrap();
    assert_eq!(claimed.id, first.id);
    f.clock.add(1.0);
    let expired = digest(queue, "expired-companion");
    f.clock
        .set_now(expired.created_at + control().result_timeout_seconds);
    let fresh = digest(queue, "fresh-companion");
    let companions: Vec<String> = queue
        .claim_companions(&claimed, 9, true)
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(companions, [fresh.id]);
    assert_eq!(job(queue, &expired.id).state, "cancelled");
}

#[test]
fn test_expired_digest_does_not_block_retrieval_batch_refill() {
    let f = clocked();
    let queue = &f.queue;
    let first = retrieval(queue, "https://www.instagram.com/p/FirstRefill/");
    let claimed = claim(queue).unwrap();
    assert_eq!(claimed.id, first);
    let expired = digest(queue, "expired-before-refill");
    f.clock
        .set_now(expired.created_at + control().result_timeout_seconds);
    let fresh = retrieval(queue, "https://www.instagram.com/p/SecondRefill/");
    let companions: Vec<String> = queue
        .claim_companions(&claimed, 9, true)
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(companions, [fresh]);
    assert_eq!(job(queue, &expired.id).state, "cancelled");
}

/// Python wrapped `enqueue_digest` to cancel and resubmit before returning. Here the
/// replacement happens on the resolver's first monotonic clock read, which comes
/// right after its submission returned.
#[test]
fn test_digest_receipt_preserves_original_generation_during_submission_return_race() {
    let f = clocked();
    let queue = f.queue.clone();
    let newer = Arc::new(Mutex::new(Vec::new()));
    let (submitter, clock, replacements) = (queue.clone(), f.clock.clone(), newer.clone());
    f.clock.on_monotonic(move || {
        let mut replacements = replacements.lock().unwrap();
        if replacements.is_empty() {
            let receipt_id: String = db(&submitter)
                .query_row("SELECT id FROM jobs", [], |row| row.get(0))
                .unwrap();
            submitter.cancel(&receipt_id).unwrap();
            clock.add(1.0);
            replacements.push(digest(&submitter, "replacement-after-submit"));
        }
    });
    assert!(
        digest_error(resolve(&queue, "replacement-after-submit")).contains("unavailable or paused")
    );
    let newer = newer.lock().unwrap();
    assert_eq!(job(&queue, &newer[0].id), newer[0]);
    assert_eq!(newer[0].state, "pending");
}

#[test]
fn test_late_digest_waiter_shares_original_admission_expiry_instead_of_extending_it() {
    let f = clocked();
    let queue = f.queue.clone();
    let receipt = digest(&queue, "shared-pending-expiry");
    f.clock.add(control().result_timeout_seconds - 10.0);

    let (worker, clock) = (queue.clone(), f.clock.clone());
    let heartbeat = move || {
        worker
            .set_setting("worker", json!({"running": true, "heartbeat": clock.now()}))
            .unwrap();
    };
    heartbeat();
    f.clock.after_sleep(heartbeat);
    assert!(digest_error(resolve(&queue, "shared-pending-expiry")).contains("timed out"));
    assert_eq!(f.clock.elapsed(), 10.0);
    assert_eq!(job(&queue, &receipt.id).state, "cancelled");
    assert_eq!(
        f.clock.now(),
        receipt.created_at + control().result_timeout_seconds
    );
}

#[test]
fn test_late_digest_waiter_can_reuse_an_already_completed_result_after_admission_expiry() {
    let f = clocked();
    let queue = &f.queue;
    let receipt = digest(queue, "completed-replay");
    queue
        .finish(&claim(queue).unwrap(), Finish::result(digest_result()))
        .unwrap();
    queue
        .set_setting(
            "worker",
            json!({"running": false, "heartbeat": f.clock.now()}),
        )
        .unwrap();
    f.clock.add(control().result_timeout_seconds + 1.0);
    let result = resolve(queue, "completed-replay").unwrap();
    assert_eq!(result.media_ids, ["123"]);
    assert_eq!(job(queue, &receipt.id).state, "succeeded");
    assert_eq!(f.clock.elapsed(), 0.0);
}

#[test]
fn test_retrieval_retry_rechecks_running_state_before_clearing_its_capture_marker() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = retrieval(queue, "https://www.instagram.com/p/ManualRetryAdmission/");
    let marker = format!("manual_enqueued:{job_id}");
    queue.set_setting(&marker, json!(true)).unwrap();
    let claimed = claim(queue).unwrap();
    assert!(value_error(queue.retry_retrieval(&job_id)).contains("idle retrieval"));
    assert_eq!(job(queue, &job_id), claimed);
    assert_eq!(queue.get_setting(&marker).unwrap(), Some(json!(true)));
}

#[test]
fn test_retrieval_retry_clears_only_its_capture_marker_before_next_claim() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = retrieval(queue, "https://www.instagram.com/p/ManualRetryMarkers/");
    queue
        .finish(
            &claim(queue).unwrap(),
            Finish::result(json!({"posts": ["old signed media"]})),
        )
        .unwrap();
    let marker = format!("profile_queued:{job_id}");
    queue.set_setting(&marker, json!(true)).unwrap();
    queue
        .set_setting("profile_queued:other", json!(true))
        .unwrap();
    queue.retry_retrieval(&job_id).unwrap();
    let claimed = claim(queue).unwrap();
    assert_eq!(claimed.attempts, 1);
    assert_eq!(claimed.result, None);
    assert_eq!(queue.get_setting(&marker).unwrap(), None);
    assert_eq!(
        queue.get_setting("profile_queued:other").unwrap(),
        Some(json!(true))
    );
}

#[test]
fn test_upgrade_drops_removed_review_storage_and_notification_capture_state() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = engagement(queue, "ReviewUpgrade");
    db(queue)
        .execute_batch(
            "CREATE TABLE review_snapshots (digest TEXT PRIMARY KEY, payload BLOB);
             CREATE TABLE review_completions (media_row_id TEXT PRIMARY KEY);",
        )
        .unwrap();
    let settings = [
        (
            format!("notification_reviewed_target:{}", uuid::Uuid::new_v4()),
            json!({"codex_review": {}}),
        ),
        (
            format!("notification_import_attempts:{}", uuid::Uuid::new_v4()),
            json!(2),
        ),
        (
            "notification_review_cursor".to_owned(),
            json!({"last_school": null, "next_newest": {}}),
        ),
        ("review_storage_status".to_owned(), json!({"checked_at": 1})),
        ("manual_imported:job-1".to_owned(), json!(true)),
        ("manual_enqueued:job-2".to_owned(), json!(true)),
        ("manual_retrieval:job-2".to_owned(), json!(true)),
        ("notification_delivery:row".to_owned(), json!("job-3")),
        (
            "notification_browser_import_claim".to_owned(),
            json!({"media_row_id": "row", "claim_token": "t"}),
        ),
        (
            "notification_ledger_claim".to_owned(),
            json!({"media_row_id": "row", "claim_token": "t"}),
        ),
        (
            "notification_source_status".to_owned(),
            json!({"checked_at": 1}),
        ),
        (
            "notification_enqueue_status".to_owned(),
            json!({"checked_at": 1}),
        ),
        ("excluded_accounts".to_owned(), json!(["wat2do.utsc"])),
    ];
    for (key, value) in settings {
        queue.set_setting(&key, value).unwrap();
    }

    let reopened = f.reopen();

    let connection = db(&reopened);
    let tables: HashSet<String> = connection
        .prepare("SELECT name FROM sqlite_master")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let keys: HashSet<String> = connection
        .prepare("SELECT key FROM settings")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(
        OBSOLETE_REVIEW_TABLES
            .iter()
            .all(|table| !tables.contains(*table))
    );
    assert_eq!(
        keys,
        HashSet::from([
            "delivery_generation".to_owned(),
            "excluded_accounts".to_owned(),
            "notification_retrievals_retired".to_owned(),
        ])
    );
    assert_eq!(job(&reopened, &job_id).state, "pending");
    assert_eq!(reopened.delivery_generation(), queue.delivery_generation());
    assert_eq!(
        reopened.current_delivery_generation().unwrap().as_deref(),
        Some(queue.delivery_generation())
    );
}

#[test]
fn test_status_distinguishes_rate_limit_hold_from_ready_admission() {
    let f = Fixture::with_clock(Clock::new(1000.0, 0.0));
    let queue = &f.queue;
    let job_id = retrieval(queue, "https://www.instagram.com/p/VisibleCooldown/");
    queue
        .defer_for_rate_limit(None, "Instagram rate limit")
        .unwrap();
    let hold = queue.status().unwrap()["rate_limit"].clone();

    assert_eq!(hold["remaining_seconds"].as_f64(), Some(backoff()));
    assert_eq!(hold["backoff_seconds"].as_f64(), Some(backoff()));
    assert!(claim(queue).is_none());

    f.clock.set_now(hold["retry_at"].as_f64().unwrap());
    assert_eq!(
        queue.status().unwrap()["rate_limit"]["remaining_seconds"].as_f64(),
        Some(0.0)
    );
    assert_eq!(claim(queue).unwrap().id, job_id);
}

#[test]
fn test_status_reports_no_rate_limit_before_any_hold() {
    let f = fixture();
    assert_eq!(
        f.queue.status().unwrap()["rate_limit"],
        json!({"retry_at": null, "remaining_seconds": 0, "backoff_seconds": 0})
    );
}

#[test]
fn test_finishing_a_retrieval_signals_its_capture_hand_off() {
    let f = fixture();
    let queue = &f.queue;
    let job_id = queue
        .enqueue_retrieval(
            "uwaterloo",
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "https://www.instagram.com/p/HANDOFF/",
            1,
        )
        .unwrap();
    queue.retrieval_finished.clear();
    let claimed = claim(queue).unwrap();
    assert!(claimed.id == job_id && !queue.retrieval_finished.is_set());

    queue
        .finish(&claimed, Finish::result(json!({"posts": []})))
        .unwrap();

    assert!(queue.retrieval_finished.is_set());
}

#[test]
fn test_first_upgrade_cancels_waiting_notification_reads_once() {
    let directory = tempfile::tempdir().unwrap();
    let clock = Clock::new(1_800_000_000.0, 0.001);
    let queue = open(&directory.path().join("state"), &clock);
    db(&queue)
        .execute_batch("DELETE FROM settings WHERE key='notification_retrievals_retired'")
        .unwrap();
    let waiting = retrieval(&queue, "https://www.instagram.com/p/NotifiedBefore/");

    let upgraded = open(&queue.state_directory, &clock);
    // Its post now waits in the ingestion queue instead.
    assert_eq!(job(&upgraded, &waiting).state, "cancelled");
    let later = retrieval(&upgraded, "https://www.instagram.com/ubcclub/");
    assert_eq!(
        job(&open(&queue.state_directory, &clock), &later).state,
        "pending"
    );
}

#[test]
fn test_a_retrieval_rate_limit_holds_retrievals_but_not_digests() {
    let f = clocked();
    let queue = &f.queue;
    retrieval(queue, "https://www.instagram.com/mcgillboardgames/");
    queue
        .defer_for_rate_limit(
            Some(&claim(queue).unwrap()),
            "Instagram browser is rate limited (HTTP 429)",
        )
        .unwrap();
    let second = retrieval(queue, "https://www.instagram.com/mcmasterboardgames/");
    let digest = digest(queue, "during-retrieval-hold");

    assert!(!queue.is_rate_limited(None, false).unwrap());
    assert!(queue.is_rate_limited(None, true).unwrap());
    assert_eq!(claim(queue).unwrap().id, digest.id);
    assert!(claim(queue).is_none());
    f.clock.add(backoff());
    assert_eq!(claim(queue).unwrap().id, second);
}
