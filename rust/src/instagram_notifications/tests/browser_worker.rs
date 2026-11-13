//! `tests/services/instagram_notifications/test_browser_worker.py`, ported.
//!
//! Python's `isolated_browser` fixture replaced the tab pool, the browser lock path and
//! `CONTROL` (`parallel_tabs` 10). Here every worker gets a [`Pool`] whose `prepare`
//! hands out sessions on scripted pages, a browser lock in a temporary directory, a
//! fake `execute_job` seam where Python patched one, and a queue in a temporary
//! directory. Python patched queue methods to raise `sqlite3` errors; here SQLite
//! triggers armed in the test's own queue database make the same writes fail.

use std::sync::Condvar;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use super::super::browser_session::{JavascriptRunner, PinnedRunner};
use super::super::errors::StorageError;
use super::super::scripts;
use super::super::test_support::{
    FakeHost, ScriptedRunner, bridge, failed, ok, queue as open_queue,
};
use super::*;
use crate::controlbox::overrides;
use crate::host::Host;

const RECIPIENT_ID: &str = "12342599092";
const ACCOUNT_USERNAME: &str = "ubc.wat2do.io";

// ---------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------

/// Python's `isolated_browser` and `queue` fixtures.
struct Env {
    dir: tempfile::TempDir,
    host: Arc<FakeHost>,
    bridge: Arc<Bridge>,
    queue: Arc<BrowserJobQueue>,
}

impl Env {
    fn new() -> Self {
        overrides::instagram_browser(|control| control.parallel_tabs = 10);
        let dir = tempfile::tempdir().expect("temporary directory");
        // No test may reach osascript: an unexpected call fails as a missing program.
        let host = FakeHost::idle();
        let bridge = bridge(&host);
        let queue = open_queue(&dir.path().join("queue"), &host);
        CLOCKS
            .lock()
            .unwrap()
            .insert(queue.database_path.clone(), host.clone());
        Self {
            dir,
            host,
            bridge,
            queue,
        }
    }

    fn lock_path(&self) -> PathBuf {
        self.dir.path().join("browser.lock")
    }

    fn pool(&self) -> Pool {
        Pool::new(&self.bridge)
    }

    /// A worker with a fake `execute_job`.
    fn worker<E>(&self, pool: Pool, execute: E) -> Worker
    where
        E: Fn(
                &BrowserJob,
                &mut BrowserInstagramSession,
                Option<&dyn Fn(&BrowserError)>,
            ) -> BrowserResult<Value>
            + Send
            + Sync
            + 'static,
    {
        let mut worker = self.real_worker(pool);
        worker.seams.execute_job = Arc::new(execute);
        worker
    }

    /// A worker that runs the real `execute_job` on the pool's sessions.
    fn real_worker(&self, pool: Pool) -> Worker {
        let mut worker = Worker::new(self.bridge.clone(), self.queue.clone(), None);
        worker.seams.tab_pool =
            Arc::new(move |_: &Worker| Box::new(pool.clone()) as Box<dyn TabPool>);
        worker.seams.browser_lock_path = self.lock_path();
        worker
    }
}

/// Assertions made on worker threads: a panic there would leave the batch waiting.
#[derive(Clone, Default)]
struct Checks(Arc<Mutex<Vec<String>>>);

impl Checks {
    fn check(&self, passed: bool, what: &str) {
        if !passed {
            self.0.lock().unwrap().push(what.to_owned());
        }
    }

    fn fail(&self, what: &str) -> BrowserError {
        self.check(false, what);
        BrowserError::other("TestFailure", what)
    }

    fn assert_none(&self) {
        assert_eq!(*self.0.lock().unwrap(), Vec::<String>::new());
    }
}

/// The worker's `execute_job` seam.
trait Executor:
    Fn(
        &BrowserJob,
        &mut BrowserInstagramSession,
        Option<&dyn Fn(&BrowserError)>,
    ) -> BrowserResult<Value>
    + Send
    + Sync
    + 'static
{
}

impl<T> Executor for T where
    T: Fn(
            &BrowserJob,
            &mut BrowserInstagramSession,
            Option<&dyn Fn(&BrowserError)>,
        ) -> BrowserResult<Value>
        + Send
        + Sync
        + 'static
{
}

/// An `execute_job` that must not run.
fn never(checks: &Checks, why: &'static str) -> impl Executor {
    let checks = checks.clone();
    move |_, _, _| Err(checks.fail(why))
}

/// An `execute_job` that returns `result` for every job.
fn returning(result: Value) -> impl Executor {
    move |_, _, _| Ok(result.clone())
}

/// `_settling_executor`: stub operations prove settlement before returning, as query does.
///
/// Python passed no session to a primary-tab engagement; the worker's primary session
/// here has no pinned tab, so engagements are not settled by the stub.
fn settling<F>(operation: F) -> impl Executor
where
    F: Fn(&BrowserJob, &mut BrowserInstagramSession) -> BrowserResult<Value>
        + Send
        + Sync
        + 'static,
{
    move |job, session, on_rate_limit| {
        let mut result = operation(job, session);
        if job.kind == "retrieval"
            && let Ok(value) = &result
        {
            result = session.current_account_username().map(|username| {
                let mut merged = value.as_object().cloned().unwrap_or_default();
                merged.insert("account_username".to_owned(), json!(username));
                Value::Object(merged)
            });
        }
        if let (Err(error), Some(on_rate_limit)) = (&result, on_rate_limit)
            && error.is(SessionKind::RateLimited)
        {
            on_rate_limit(error);
        }
        if job.kind != "engagement" {
            session.cancel_pending_request()?;
        }
        result
    }
}

type Prepare = dyn Fn(&BrowserJob, usize) -> BrowserResult<(Vec<BrowserInstagramSession>, String)>
    + Send
    + Sync;

type AddAccount = dyn Fn(&str) -> BrowserResult<()> + Send + Sync;
type Settle = dyn Fn() -> BrowserResult<Vec<BrowserInstagramSession>> + Send + Sync;

/// The fixture's `BrowserTabPool`: each method can be replaced by a test.
#[derive(Clone)]
struct Pool {
    prepare: Arc<Prepare>,
    settle: Arc<Settle>,
    ensure: Arc<dyn Fn() -> BrowserResult<Vec<String>> + Send + Sync>,
    recover_login: Arc<dyn Fn() -> BrowserResult<String> + Send + Sync>,
    add_account: Arc<AddAccount>,
}

impl Pool {
    fn new(bridge: &Arc<Bridge>) -> Self {
        let bridge = bridge.clone();
        Self {
            prepare: Arc::new(move |_, count| {
                Ok((
                    (0..count)
                        .map(|index| Tab::new(index).session(&bridge))
                        .collect(),
                    ACCOUNT_USERNAME.to_owned(),
                ))
            }),
            settle: Arc::new(|| Ok(Vec::new())),
            ensure: Arc::new(|| Ok(Vec::new())),
            recover_login: Arc::new(|| Err(BrowserError::other("AttributeError", "recover_login"))),
            add_account: Arc::new(|_| Err(BrowserError::other("AttributeError", "add_account"))),
        }
    }

    fn prepare(
        mut self,
        prepare: impl Fn(&BrowserJob, usize) -> BrowserResult<(Vec<BrowserInstagramSession>, String)>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        self.prepare = Arc::new(prepare);
        self
    }

    /// `prepare` handing out freshly built `tabs` and the verified account.
    fn tabs(
        self,
        bridge: &Arc<Bridge>,
        tabs: impl Fn() -> Vec<Tab> + Send + Sync + 'static,
    ) -> Self {
        let bridge = bridge.clone();
        self.prepare(move |_, _| {
            Ok((
                tabs().into_iter().map(|tab| tab.session(&bridge)).collect(),
                ACCOUNT_USERNAME.to_owned(),
            ))
        })
    }

    fn settle(
        mut self,
        settle: impl Fn() -> BrowserResult<Vec<BrowserInstagramSession>> + Send + Sync + 'static,
    ) -> Self {
        self.settle = Arc::new(settle);
        self
    }

    fn ensure(
        mut self,
        ensure: impl Fn() -> BrowserResult<Vec<String>> + Send + Sync + 'static,
    ) -> Self {
        self.ensure = Arc::new(ensure);
        self
    }

    fn recover_login(
        mut self,
        recover: impl Fn() -> BrowserResult<String> + Send + Sync + 'static,
    ) -> Self {
        self.recover_login = Arc::new(recover);
        self
    }

    fn add_account(
        mut self,
        add: impl Fn(&str) -> BrowserResult<()> + Send + Sync + 'static,
    ) -> Self {
        self.add_account = Arc::new(add);
        self
    }
}

impl TabPool for Pool {
    fn prepare(
        &self,
        job: &BrowserJob,
        count: usize,
    ) -> BrowserResult<(Vec<BrowserInstagramSession>, String)> {
        (self.prepare)(job, count)
    }

    fn ensure_capacity(&self, _bootstrap_username: Option<&str>) -> BrowserResult<Vec<String>> {
        (self.ensure)()
    }

    fn settle_registered_tabs(&self) -> BrowserResult<Vec<BrowserInstagramSession>> {
        (self.settle)()
    }

    fn recover_login(&self) -> BrowserResult<String> {
        (self.recover_login)()
    }

    fn add_account(&self, username: &str) -> BrowserResult<()> {
        (self.add_account)(username)
    }
}

/// What one fake Instagram tab shows.
struct PageState {
    index: usize,
    path: String,
    username: Option<String>,
    /// The `result` the next query settles with; None answers by the page's path.
    query_result: Option<Value>,
    /// What `REQUEST_STATE` reads.
    request: Value,
    clicked: HashSet<String>,
    sources: Vec<String>,
    navigations: Vec<(String, bool)>,
    queries: Vec<String>,
    /// Cancellations the page settled.
    cancels: usize,
}

type Hook = dyn FnMut(&str, &mut PageState) -> Option<BrowserResult<String>> + Send;
type NavigationHook = dyn FnMut(&str, bool, &mut PageState) -> Option<BrowserResult<String>> + Send;

/// A scripted Instagram tab: Python's `SimpleNamespace` sessions, answered at the page.
struct Tab {
    page: Arc<Mutex<PageState>>,
    hook: Box<Hook>,
    navigation: Box<NavigationHook>,
    secondary: bool,
}

impl Tab {
    /// The fixture's session: on `/`, logged in as the school, settling at once.
    fn new(index: usize) -> Self {
        Self {
            page: Arc::new(Mutex::new(PageState {
                index,
                path: "/".to_owned(),
                username: Some(ACCOUNT_USERNAME.to_owned()),
                query_result: None,
                request: Value::Null,
                clicked: HashSet::new(),
                sources: Vec::new(),
                navigations: Vec::new(),
                queries: Vec::new(),
                cancels: 0,
            })),
            hook: Box::new(|_, _| None),
            navigation: Box::new(|_, _, _| None),
            secondary: false,
        }
    }

    fn at(self, path: &str) -> Self {
        self.page.lock().unwrap().path = path.to_owned();
        self
    }

    /// Answer some sources differently; None falls back to the page.
    fn hook(
        mut self,
        hook: impl FnMut(&str, &mut PageState) -> Option<BrowserResult<String>> + Send + 'static,
    ) -> Self {
        self.hook = Box::new(hook);
        self
    }

    /// Answer navigations differently; None loads the URL.
    fn on_navigate(
        mut self,
        hook: impl FnMut(&str, bool, &mut PageState) -> Option<BrowserResult<String>> + Send + 'static,
    ) -> Self {
        self.navigation = Box::new(hook);
        self
    }

    /// A pinned secondary read tab (Python's `is_secondary_read_tab=True`).
    fn secondary(mut self) -> Self {
        self.secondary = true;
        self
    }

    fn page(&self) -> Arc<Mutex<PageState>> {
        self.page.clone()
    }

    fn session(self, bridge: &Arc<Bridge>) -> BrowserInstagramSession {
        let Self {
            page,
            mut hook,
            mut navigation,
            secondary,
        } = self;
        let navigated = page.clone();
        let index = page.lock().unwrap().index;
        let script = ScriptedRunner::new(move |source| {
            let mut page = page.lock().unwrap();
            page.sources.push(source.to_owned());
            match hook(source, &mut page) {
                Some(answer) => answer,
                None => answer(source, &mut page),
            }
        })
        .with_navigation(move |url, reload| {
            let mut page = navigated.lock().unwrap();
            page.navigations.push((url.to_owned(), reload));
            if let Some(answer) = navigation(url, reload, &mut page) {
                return answer;
            }
            page.path = crate::urls::urlsplit(url, "").expect("valid URL").path;
            Ok("navigating".to_owned())
        });
        let pinned = secondary.then(|| {
            let mut pinned = PinnedRunner::tab(bridge, &(41 + index).to_string());
            pinned.window_id = Some((900 + index).to_string());
            pinned
        });
        BrowserInstagramSession::new(
            bridge.clone(),
            Box::new(TabRunner { script, pinned }),
            !secondary,
            None,
        )
    }
}

/// Runs every source on the scripted page; a secondary tab also has a pinned identity,
/// which only retirement uses (through the fake host).
struct TabRunner {
    script: ScriptedRunner,
    pinned: Option<PinnedRunner>,
}

impl JavascriptRunner for TabRunner {
    fn run(&mut self, source: &str, timeout: f64) -> BrowserResult<String> {
        self.script.run(source, timeout)
    }

    fn navigate(&mut self, url: &str, timeout: f64, reload: bool) -> Option<BrowserResult<String>> {
        self.script.navigate(url, timeout, reload)
    }

    fn pinned(&mut self) -> Option<&mut PinnedRunner> {
        self.pinned.as_mut()
    }
}

/// The source a test asks a session's page for its index.
const INDEX_SOURCE: &str = "test:index";

fn index_of(session: &mut BrowserInstagramSession) -> usize {
    session
        .run(INDEX_SOURCE)
        .ok()
        .and_then(|index| index.parse().ok())
        .unwrap_or(usize::MAX)
}

fn post(url: &str) -> Value {
    json!({
        "url": url,
        "ownerUsername": "club",
        "timestamp": "2026-10-07T12:00:00+00:00",
        "caption": "Event",
        "type": "Image",
        "coauthors": [],
        "displayUrl": "https://s.cdninstagram.com/fixture.jpg",
    })
}

/// How the fake page answers every script the worker's operations run.
fn answer(source: &str, page: &mut PageState) -> BrowserResult<String> {
    let url = format!("https://www.instagram.com{}", page.path);
    let text = if source == scripts::CANCEL_REQUEST {
        page.cancels += 1;
        "settled".to_owned()
    } else if source == scripts::CLEAR_REQUEST {
        "cleared".to_owned()
    } else if source == scripts::PAGE_RESPONSE {
        json!({"path": page.path, "rate_limited": false}).to_string()
    } else if source == scripts::CURRENT_PATH {
        page.path.clone()
    } else if source == scripts::CURRENT_ACCOUNT_USERNAME {
        page.username.clone().unwrap_or_default()
    } else if source == scripts::recipient_is_active(RECIPIENT_ID) {
        "true".to_owned()
    } else if source == scripts::ACCOUNT_CHOOSER_STATE {
        "absent".to_owned()
    } else if source == scripts::REQUEST_STATE {
        page.request.to_string()
    } else if source == INDEX_SOURCE {
        page.index.to_string()
    } else if source == format!("({}).status", scripts::post_context(&url)) {
        "ready".to_owned()
    } else if let Some((action, click)) = control().actions.iter().find_map(|action| {
        [false, true].into_iter().find_map(|click| {
            (source == scripts::engagement(RECIPIENT_ID, ACCOUNT_USERNAME, &url, action, click))
                .then(|| (action.clone(), click))
        })
    }) {
        let status = if click {
            page.clicked.insert(action);
            "clicked"
        } else if page.clicked.contains(&action) {
            "already_done"
        } else {
            "ready"
        };
        json!({"status": status}).to_string()
    } else if source.contains(scripts::REQUEST_KEY) {
        page.queries.push(page.path.clone());
        let result = page.query_result.clone().unwrap_or_else(|| {
            if page.path.starts_with("/p/") {
                json!({"state": "succeeded", "posts": [post(&url)]})
            } else {
                json!({"state": "succeeded", "media_ids": ["123"], "page_count": 1})
            }
        });
        page.request = json!({"result": result, "settled": true});
        "started".to_owned()
    } else {
        let preview: String = source.chars().take(80).collect();
        return Err(BrowserError::other(
            "TestFailure",
            format!("unexpected page source: {preview}"),
        ));
    };
    Ok(text)
}

// ---------------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------------

/// Each test queue's fake host, so enqueuing can let its clock tick: Python's jobs got
/// distinct `created_at` times, and the queue claims in that order.
static CLOCKS: std::sync::LazyLock<Mutex<std::collections::HashMap<PathBuf, Arc<FakeHost>>>> =
    std::sync::LazyLock::new(Mutex::default);

fn tick(queue: &BrowserJobQueue) {
    let host = CLOCKS.lock().unwrap().get(&queue.database_path).cloned();
    if let Some(host) = host {
        host.advance(0.001);
    }
}

fn engagement(queue: &BrowserJobQueue, shortcode: &str) -> String {
    tick(queue);
    queue
        .enqueue_engagement(
            "ubc",
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            &format!("https://www.instagram.com/p/{shortcode}/"),
            None,
            false,
        )
        .expect("engagement queues")
}

fn digest(queue: &BrowserJobQueue, cache_ent_id: &str) -> String {
    tick(queue);
    queue
        .enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, cache_ent_id)
        .expect("digest queues")
        .id
}

fn retrieval(queue: &BrowserJobQueue, shortcode: &str) -> String {
    tick(queue);
    queue
        .enqueue_retrieval(
            "ubc",
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            &format!("https://www.instagram.com/p/{shortcode}/"),
            1,
        )
        .expect("retrieval queues")
}

fn following(queue: &BrowserJobQueue, username: &str) -> String {
    tick(queue);
    queue
        .enqueue_following("ubc", "wat2do.ubc", "crawl-1", username, Some("101"), None)
        .expect("Following read queues")
        .id
}

fn enqueue(queue: &BrowserJobQueue, kind: &str, name: &str) -> String {
    match kind {
        "engagement" => engagement(queue, name),
        "digest" => digest(queue, name),
        _ => retrieval(queue, name),
    }
}

fn job(queue: &BrowserJobQueue, id: &str) -> BrowserJob {
    queue.get(id).expect("queue reads").expect("job exists")
}

fn setting(queue: &BrowserJobQueue, key: &str) -> Option<Value> {
    queue.get_setting(key).expect("queue reads")
}

fn paused(queue: &BrowserJobQueue) -> Value {
    queue
        .setting_or("paused", Value::Bool(false))
        .expect("queue reads")
}

fn paused_text(queue: &BrowserJobQueue) -> String {
    paused(queue).as_str().unwrap_or_default().to_owned()
}

fn is_paused(queue: &BrowserJobQueue) -> bool {
    truthy(&paused(queue))
}

fn worker_running(queue: &BrowserJobQueue) -> Value {
    setting(queue, "worker").expect("worker status")["running"].clone()
}

fn lock_file(path: &std::path::Path) -> File {
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(path)
        .expect("lock file opens")
}

/// Whether another holder owns the browser lock right now.
fn lock_is_held(path: &std::path::Path) -> bool {
    let probe = lock_file(path);
    match probe.try_lock_exclusive() {
        Ok(()) => {
            let _ = FileExt::unlock(&probe);
            false
        }
        Err(_) => true,
    }
}

fn storage_error(code: i32, message: &str) -> BrowserError {
    BrowserError::Storage(StorageError {
        code: Some(code),
        message: message.to_owned(),
    })
}

/// The diagnostics the queue recorded, as `(state, job_id)`.
fn diagnostics(queue: &BrowserJobQueue) -> Vec<(String, Option<String>)> {
    let db = rusqlite::Connection::open(&queue.database_path).expect("queue database opens");
    let mut statement = db
        .prepare("SELECT event FROM diagnostic_events ORDER BY rowid")
        .expect("diagnostics read");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("diagnostics read")
        .map(|event| {
            let event: Value = serde_json::from_str(&event.expect("diagnostic row")).expect("JSON");
            (
                event["payload"]["state"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                event["payload"]["job_id"].as_str().map(str::to_owned),
            )
        })
        .collect()
}

// Storage failures: SQLite triggers in the test's queue raise on the writes a test arms,
// as Python's patched queue methods raised `sqlite3.OperationalError`.
const FAULT_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS test_faults (name TEXT PRIMARY KEY);
CREATE TRIGGER IF NOT EXISTS test_fault_finish BEFORE UPDATE OF state ON jobs
WHEN OLD.state = 'running' AND NEW.state != 'running' AND (
    EXISTS (SELECT 1 FROM test_faults WHERE name = 'finish:' || OLD.id)
    OR (NEW.state = 'succeeded' AND EXISTS (SELECT 1 FROM test_faults WHERE name = 'succeed:' || OLD.id)))
BEGIN SELECT RAISE(ABORT, 'private SQL and filesystem details'); END;
CREATE TRIGGER IF NOT EXISTS test_fault_diagnostic BEFORE INSERT ON diagnostic_events
WHEN EXISTS (SELECT 1 FROM test_faults WHERE name = 'diagnostics')
BEGIN SELECT RAISE(ABORT, 'private SQL and filesystem details'); END;
CREATE TRIGGER IF NOT EXISTS test_fault_setting_insert BEFORE INSERT ON settings
WHEN EXISTS (SELECT 1 FROM test_faults WHERE name = 'setting:' || NEW.key)
    OR (NEW.key = 'worker' AND json_extract(NEW.value, '$.running') = 0
        AND EXISTS (SELECT 1 FROM test_faults WHERE name = 'shutdown'))
BEGIN SELECT RAISE(ABORT, 'private SQL and filesystem details'); END;
CREATE TRIGGER IF NOT EXISTS test_fault_setting_update BEFORE UPDATE ON settings
WHEN EXISTS (SELECT 1 FROM test_faults WHERE name = 'setting:' || NEW.key)
    OR (NEW.key = 'worker' AND json_extract(NEW.value, '$.running') = 0
        AND EXISTS (SELECT 1 FROM test_faults WHERE name = 'shutdown'))
BEGIN SELECT RAISE(ABORT, 'private SQL and filesystem details'); END;
";

fn faults(queue: &BrowserJobQueue) -> rusqlite::Connection {
    let db = rusqlite::Connection::open(&queue.database_path).expect("queue database opens");
    db.busy_timeout(Duration::from_secs(5))
        .expect("busy timeout");
    db.execute_batch(FAULT_SCHEMA)
        .expect("fault triggers install");
    db
}

fn arm(queue: &BrowserJobQueue, name: &str) {
    faults(queue)
        .execute("INSERT OR IGNORE INTO test_faults VALUES (?)", [name])
        .expect("fault arms");
}

fn disarm(queue: &BrowserJobQueue, name: &str) {
    faults(queue)
        .execute("DELETE FROM test_faults WHERE name=?", [name])
        .expect("fault disarms");
}

// ---------------------------------------------------------------------------------
// Threads, time and logs
// ---------------------------------------------------------------------------------

/// Poll `condition` for up to five seconds.
fn wait_until(mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    condition()
}

/// `threading.Barrier(n)` with Python's five-second wait timeout.
struct Barrier {
    parties: usize,
    arrived: Mutex<usize>,
    changed: Condvar,
}

impl Barrier {
    fn new(parties: usize) -> Arc<Self> {
        Arc::new(Self {
            parties,
            arrived: Mutex::new(0),
            changed: Condvar::new(),
        })
    }

    fn wait(&self) -> bool {
        let mut arrived = self.arrived.lock().unwrap();
        *arrived += 1;
        self.changed.notify_all();
        let (arrived, _) = self
            .changed
            .wait_timeout_while(arrived, Duration::from_secs(5), |arrived| {
                *arrived < self.parties
            })
            .unwrap();
        *arrived >= self.parties
    }
}

/// Move the virtual clock while the worker loop waits in real time.
struct Ticker {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Ticker {
    fn start(host: &Arc<FakeHost>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let (running, host) = (stop.clone(), host.clone());
        let thread = std::thread::spawn(move || {
            while !running.load(Ordering::SeqCst) {
                host.advance(0.01);
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Clone, Default)]
struct Logs(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Logs {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Python's `caplog`: what `operation` logged on this thread.
fn capture_logs<T>(operation: impl FnOnce() -> T) -> (T, String) {
    let logs = Logs::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish();
    let result = tracing::subscriber::with_default(subscriber, operation);
    let text = String::from_utf8_lossy(&logs.0.lock().unwrap()).into_owned();
    (result, text)
}

fn number(value: Option<Value>) -> f64 {
    value.and_then(|value| value.as_f64()).unwrap_or_default()
}

// ---------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------

#[test]
fn test_busy_browser_lock_prevents_claiming_any_job() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let checks = Checks::default();
    let worker = env.worker(env.pool(), never(&checks, "No browser ownership"));
    let held = lock_file(&env.lock_path());
    held.try_lock_exclusive()
        .expect("test holds the browser lock");
    assert!(!worker.process_next_job(true).unwrap());
    drop(held);
    assert_eq!(job(&env.queue, &job_id).state, "pending");
    assert_eq!(job(&env.queue, &job_id).attempts, 0);
    checks.assert_none();
}

#[test]
fn test_known_full_storage_stops_a_claim_before_browser_execution() {
    for kind in ["digest", "engagement"] {
        let env = Env::new();
        let job_id = enqueue(&env.queue, kind, "stop-before-execution");
        // The claim's "running" diagnostic finds storage unavailable.
        arm(&env.queue, "diagnostics");
        let checks = Checks::default();
        let worker = env.worker(env.pool(), never(&checks, "Full storage"));
        assert!(!worker.process_next_job(true).unwrap(), "{kind}");
        assert_eq!(job(&env.queue, &job_id).state, "running", "{kind}");
        assert!(env.queue.is_storage_unavailable(), "{kind}");
        checks.assert_none();
    }
}

#[test]
fn test_full_completion_drains_all_parallel_reads_and_preserves_other_auth_failures() {
    for auth_failure in [false, true] {
        let env = Env::new();
        let job_ids: Vec<String> = (0..2)
            .map(|index| retrieval(&env.queue, &format!("StorageDrain{index}")))
            .collect();
        arm(&env.queue, &format!("succeed:{}", job_ids[0]));
        let drained = Arc::new(Mutex::new(Vec::new()));
        let later = Arc::new(Mutex::new(Vec::new()));
        let checks = Checks::default();
        let (ids, queue, drained_by, later_ids, check) = (
            job_ids.clone(),
            env.queue.clone(),
            drained.clone(),
            later.clone(),
            checks.clone(),
        );
        let worker = env.worker(
            env.pool(),
            settling(move |job, _| {
                if job.id == ids[1] {
                    // The first job's completion write failed.
                    check.check(
                        wait_until(|| queue.is_storage_unavailable()),
                        "full completion seen",
                    );
                    // Python's failing finish queued this read as it raised.
                    later_ids
                        .lock()
                        .unwrap()
                        .push(retrieval(&queue, "DoNotRefillStorage"));
                    if auth_failure {
                        return Err(BrowserError::session(
                            "Instagram browser requires human account recovery",
                        ));
                    }
                }
                drained_by.lock().unwrap().push(job.id.clone());
                Ok(json!({"status": "succeeded"}))
            }),
        );
        let result = worker.process_next_job(true);
        assert!(
            matches!(&result, Err(error) if error.is_storage()),
            "{result:?}"
        );
        checks.assert_none();
        assert!(drained.lock().unwrap().contains(&job_ids[0]));
        assert_eq!(job(&env.queue, &job_ids[0]).state, "running");
        assert_eq!(
            job(&env.queue, &job_ids[1]).state,
            if auth_failure { "failed" } else { "succeeded" }
        );
        let later = later.lock().unwrap()[0].clone();
        assert_eq!(job(&env.queue, &later).state, "pending");
        assert_eq!(job(&env.queue, &later).attempts, 0);
        disarm(&env.queue, &format!("succeed:{}", job_ids[0]));
        worker.recover_worker_queue().unwrap();
        assert_eq!(job(&env.queue, &job_ids[0]).state, "pending");
        assert_eq!(is_paused(&env.queue), auth_failure);
        assert!(!env.queue.is_storage_unavailable());
    }
}

#[test]
fn test_worker_waits_for_storage_then_retries_safe_read_without_an_operator_pause() {
    let env = Env::new();
    overrides::instagram_browser(|control| {
        control.storage_retry_interval_seconds = 0.01;
        control.worker_poll_interval_seconds = 0.01;
    });
    let job_id = digest(&env.queue, "worker-storage-recovery");
    let executions = Arc::new(Mutex::new(Vec::new()));
    let recoveries = Arc::new(AtomicUsize::new(0));
    let terminate = Arc::new(Event::default());
    let fault = format!("succeed:{job_id}");
    let (queue, executed, stop) = (env.queue.clone(), executions.clone(), terminate.clone());
    let recovered = recoveries.clone();
    let pool = env.pool().settle(move || {
        recovered.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    });
    let worker = env.worker(
        pool,
        settling(move |job, _| {
            let mut executed = executed.lock().unwrap();
            executed.push(job.id.clone());
            if executed.len() == 1 {
                arm(&queue, &fault);
            } else {
                disarm(&queue, &fault);
                stop.set();
            }
            Ok(json!({"status": "succeeded"}))
        }),
    );
    let (result, logs) = capture_logs(|| worker.run(false, false, terminate));
    result.unwrap();
    assert_eq!(
        *executions.lock().unwrap(),
        vec![job_id.clone(), job_id.clone()]
    );
    assert_eq!(recoveries.load(Ordering::SeqCst), 2);
    assert_eq!(job(&env.queue, &job_id).state, "succeeded");
    assert_eq!(job(&env.queue, &job_id).attempts, 2);
    assert!(!is_paused(&env.queue));
    assert_eq!(worker_running(&env.queue), json!(false));
    assert!(logs.contains("waiting for storage"), "{logs}");
    assert!(!logs.contains("private SQL"), "{logs}");
}

#[test]
fn test_successful_engagement_with_unstored_completion_never_replays_automatically() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    arm(&env.queue, &format!("finish:{job_id}"));
    let executions = Arc::new(Mutex::new(Vec::new()));
    let executed = executions.clone();
    let worker = env.worker(env.pool(), move |job, _, _| {
        executed.lock().unwrap().push(job.id.clone());
        Ok(json!({"status": "succeeded"}))
    });
    let result = worker.process_next_job(true);
    assert!(
        matches!(&result, Err(error) if error.is_storage()),
        "{result:?}"
    );
    disarm(&env.queue, &format!("finish:{job_id}"));
    worker.recover_worker_queue().unwrap();
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert!(paused_text(&env.queue).contains("completion could not be stored"));
    assert!(!worker.process_next_job(true).unwrap());
    assert_eq!(*executions.lock().unwrap(), vec![job_id]);
}

#[test]
fn test_uncertain_engagement_pauses_all_work_without_automatic_replay() {
    for stage in ["dispatch", "completion"] {
        let env = Env::new();
        let job_id = engagement(&env.queue, "Post1");
        let later = engagement(&env.queue, "UncertainNextAction");
        let reason = format!(
            "Instagram engagement {stage} is uncertain; inspect browser state before resuming"
        );
        let executions = Arc::new(Mutex::new(Vec::new()));
        let (executed, message) = (executions.clone(), reason.clone());
        let worker = env.worker(env.pool(), move |job, _, _| {
            executed.lock().unwrap().push(job.id.clone());
            Err(BrowserError::uncertain(message.clone()))
        });
        assert!(worker.process_next_job(true).unwrap());
        assert_eq!(job(&env.queue, &job_id).state, "failed");
        assert_eq!(paused(&env.queue), json!(reason));
        assert!(!worker.process_next_job(true).unwrap());
        assert_eq!(job(&env.queue, &later).state, "pending");
        assert_eq!(job(&env.queue, &later).attempts, 0);
        assert_eq!(*executions.lock().unwrap(), vec![job_id]);
    }
}

#[test]
fn test_shutdown_storage_failure_preserves_signal_cleanup_and_original_failure() {
    let env = Env::new();
    arm(&env.queue, "shutdown");
    // Python's process_next_job raised ValueError("safe"); here the startup recovery does.
    let pool = env
        .pool()
        .settle(|| Err(BrowserError::Value("safe".to_owned())));
    let checks = Checks::default();
    let worker = env.worker(pool, never(&checks, "Recovery failed first"));
    let (result, logs) = capture_logs(|| worker.run(true, false, Arc::new(Event::default())));
    assert!(
        matches!(&result, Err(BrowserError::Value(message)) if message == "safe"),
        "{result:?}"
    );
    assert!(
        logs.contains("Could not record browser worker shutdown"),
        "{logs}"
    );
    assert!(!logs.contains("private SQL"), "{logs}");
    // The heartbeat thread was joined: its last write still says running.
    assert_eq!(worker_running(&env.queue), json!(true));
    checks.assert_none();
}

#[test]
fn test_digest_overtakes_likes_during_engagement_cooldown() {
    let env = Env::new();
    env.host.set_time(10_000.0);
    let first = engagement(&env.queue, "First");
    let second = engagement(&env.queue, "Second");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let record = executed.clone();
    let worker = env.worker(env.pool(), move |job, _, _| {
        record.lock().unwrap().push(job.id.clone());
        Ok(json!({"status": "succeeded"}))
    });
    let interval = control().engagement_interval_seconds;
    env.host.set_time(10_000.0);
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(
        number(setting(&env.queue, "next_engagement_at")),
        10_000.0 + interval
    );
    assert!(!worker.process_next_job(true).unwrap());
    let digest_id = digest(&env.queue, "cache-priority");
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(
        *executed.lock().unwrap(),
        vec![first.clone(), digest_id.clone()]
    );
    assert_eq!(job(&env.queue, &second).state, "pending");

    env.host.set_time(10_000.0 + interval);
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(*executed.lock().unwrap(), vec![first, digest_id, second]);
}

#[test]
fn test_job_deadline_disarms_alarm_and_restores_signal_handler() {
    // Python's SIGALRM deadline is a per-thread deadline on the virtual clock: it
    // raises inside and is gone afterwards.
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let seconds = control().job_timeout_seconds;
    let inside = with_job_deadline(&bridge, seconds, || {
        assert!(bridge.check().is_ok());
        host.advance(seconds);
        bridge.check()
    });
    assert!(
        matches!(&inside, Err(BrowserError::Timeout(message)) if message.contains("deadline")),
        "{inside:?}"
    );
    assert!(bridge.check().is_ok());
    host.advance(seconds * 10.0);
    assert!(bridge.check().is_ok());
}

#[test]
fn test_timed_out_job_is_failed_once_and_releases_browser_for_digest() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::Timeout(
            "Instagram browser job exceeded its deadline".to_owned(),
        ))
    });
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert!(job(&env.queue, &job_id).error.unwrap().contains("deadline"));
    assert!(number(setting(&env.queue, "next_engagement_at")) > 0.0);
    assert!(!is_paused(&env.queue));

    let digest_id = digest(&env.queue, "cache-after-timeout");
    let worker = env.worker(env.pool(), returning(json!({"status": "succeeded"})));
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &digest_id).state, "succeeded");
    assert_eq!(job(&env.queue, &job_id).state, "failed");
}

#[test]
fn test_unconfirmed_cleanup_of_a_read_only_job_does_not_pause_the_worker() {
    let env = Env::new();
    let digest_id = digest(&env.queue, "cache-uncertain");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::session(
            "Instagram browser request cancellation could not be confirmed: \
             Instagram browser automation timed out",
        ))
    });
    assert!(worker.process_next_job(true).unwrap());
    assert!(["failed", "pending"].contains(&job(&env.queue, &digest_id).state.as_str()));
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_unconfirmed_cleanup_quarantines_all_browser_work() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::session(
            "Instagram browser request cancellation could not be confirmed",
        ))
    });
    assert!(worker.process_next_job(true).unwrap());
    let digest_id = digest(&env.queue, "cache-quarantined");
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert!(paused_text(&env.queue).contains("cancellation could not be confirmed"));
    assert!(!worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &digest_id).state, "pending");
}

#[test]
fn test_interruption_fails_job_and_quarantines_before_releasing_lock() {
    // KeyboardInterrupt and SystemExit are both `BrowserError::Interrupted`.
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let worker = env.worker(env.pool(), |_, _, _| Err(BrowserError::Interrupted));
    assert!(matches!(
        worker.process_next_job(true),
        Err(BrowserError::Interrupted)
    ));
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert!(is_paused(&env.queue));
    assert!(!lock_is_held(&env.lock_path()));
}

#[test]
fn test_unexpected_exception_is_sanitized_and_requires_inspection() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::other(
            "RuntimeError",
            "private request credential details",
        ))
    });
    let (processed, logs) = capture_logs(|| worker.process_next_job(true));
    assert!(processed.unwrap());
    let error = job(&env.queue, &job_id).error.unwrap();
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert!(error.contains("RuntimeError"));
    assert!(is_paused(&env.queue));
    assert!(!error.contains("private request credential details"));
    assert!(
        !logs.contains("private request credential details"),
        "{logs}"
    );
}

#[test]
fn test_storage_failure_codes_have_fixed_sanitized_diagnostics() {
    let full = "Browser queue storage is full; free disk space before resuming";
    let locked = "Browser queue storage is locked; inspect competing queue writers before resuming";
    let unavailable = "Browser queue storage is unavailable; inspect before resuming";
    for (code, reason) in [
        (Some(13), full),
        (Some(5), locked),
        (Some(6), locked),
        (
            Some(8),
            "Browser queue storage is read-only; restore write access before resuming",
        ),
        (Some(10), unavailable),
        (Some(13 | 256), full),
        (None, unavailable),
    ] {
        let failure = BrowserError::Storage(StorageError {
            code,
            message: "private SQL payload and filesystem details".to_owned(),
        });
        assert_eq!(storage_failure_reason(&failure), Some(reason), "{code:?}");
    }
}

#[test]
fn test_full_job_storage_stops_admission_and_preserves_safe_recovery() {
    for kind in ["engagement", "digest", "retrieval"] {
        let env = Env::new();
        let job_id = enqueue(&env.queue, kind, "StorageError");
        let worker = env.worker(env.pool(), |_, _, _| {
            Err(storage_error(13, "private SQL payload"))
        });
        let (result, logs) = capture_logs(|| worker.process_next_job(true));
        assert!(
            matches!(&result, Err(error) if error.is_storage()),
            "{kind}: {result:?}"
        );
        assert_eq!(job(&env.queue, &job_id).state, "running", "{kind}");
        assert!(env.queue.is_storage_unavailable(), "{kind}");
        assert_eq!(is_paused(&env.queue), kind == "engagement", "{kind}");
        worker.recover_worker_queue().unwrap();
        assert_eq!(
            job(&env.queue, &job_id).state,
            if kind == "engagement" {
                "failed"
            } else {
                "pending"
            },
            "{kind}"
        );
        assert_eq!(is_paused(&env.queue), kind == "engagement", "{kind}");
        assert!(!env.queue.is_storage_unavailable(), "{kind}");
        assert!(!logs.contains("private SQL payload"), "{logs}");
        assert!(!env.queue.is_rate_limited(None, false).unwrap(), "{kind}");
    }
}

#[test]
fn test_background_storage_failure_reports_full_disk_without_raw_details() {
    let reason = "Browser queue storage is full; free disk space before resuming";

    // collector
    let env = Env::new();
    let worker = env.worker(env.pool(), returning(Value::Null));
    let ((), logs) = capture_logs(|| {
        worker.collect("source_status", || {
            Err(anyhow::Error::new(storage_error(
                13,
                "private filesystem details",
            )))
        })
    });
    assert_eq!(
        setting(&env.queue, "source_status").unwrap()["error"],
        json!(reason)
    );
    assert!(logs.contains(reason), "{logs}");
    assert!(!logs.contains("private filesystem details"), "{logs}");

    // heartbeat: every write fails, and the thread keeps going until it is stopped.
    // Its log lines are written on its own thread, which this capture cannot see.
    let env = Env::new();
    overrides::instagram_browser(|control| control.worker_poll_interval_seconds = 0.01);
    arm(&env.queue, "setting:worker");
    let worker = env.worker(env.pool(), returning(Value::Null));
    let stopping = Arc::new(Event::default());
    let heartbeat = worker.keep_worker_alive(stopping.clone());
    std::thread::sleep(Duration::from_millis(50));
    assert!(!heartbeat.is_finished());
    stopping.set();
    heartbeat.join().unwrap();
    assert_eq!(setting(&env.queue, "worker"), None);
}

#[test]
fn test_known_account_failure_does_not_quarantine_other_notifications() {
    let env = Env::new();
    let failed_id = digest(&env.queue, "cache-missing-account");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::session(
            "Matching Instagram browser account is unavailable",
        ))
    });
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &failed_id).state, "failed");
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_human_recovery_failure_pauses_before_more_jobs_are_claimed() {
    for stage in ["preparation", "execution"] {
        for kind in ["engagement", "digest", "retrieval"] {
            let env = Env::new();
            overrides::instagram_browser(|control| control.parallel_tabs = 2);
            let reason = "Instagram requires human account recovery";
            let ids: Vec<String> = (0..3)
                .map(|index| enqueue(&env.queue, kind, &format!("Foreground{index}")))
                .collect();
            let checks = Checks::default();
            let worker = if stage == "preparation" {
                let pool = env
                    .pool()
                    .settle(move || Err(BrowserError::session(reason)))
                    .prepare(move |_, _| Err(BrowserError::session(reason)));
                env.worker(pool, never(&checks, "Preparation must stop first"))
            } else {
                env.worker(env.pool(), move |_, _, _| {
                    Err(BrowserError::session(reason))
                })
            };
            let case = format!("{stage} {kind}");
            assert!(worker.process_next_job(true).unwrap(), "{case}");
            assert_eq!(paused(&env.queue), json!(reason), "{case}");
            assert_eq!(job(&env.queue, &ids[0]).state, "failed", "{case}");
            assert_eq!(
                job(&env.queue, &ids[0]).error.as_deref(),
                Some(reason),
                "{case}"
            );
            // A streaming read may already occupy the second slot before the first
            // failure settles. The hold must preserve work not yet admitted.
            assert_eq!(job(&env.queue, &ids[2]).state, "pending", "{case}");
            assert_eq!(job(&env.queue, &ids[2]).attempts, 0, "{case}");
            env.queue
                .set_setting("next_engagement_at", json!(0))
                .unwrap();
            assert!(!worker.process_next_job(true).unwrap(), "{case}");
            assert_eq!(job(&env.queue, &ids[2]).state, "pending", "{case}");
            assert_eq!(job(&env.queue, &ids[2]).attempts, 0, "{case}");
            assert!(!env.queue.is_rate_limited(None, false).unwrap(), "{case}");
            checks.assert_none();
        }
    }
}

#[test]
fn test_execute_job_shares_pinned_session_without_repeating_successful_operation_cleanup() {
    // Python stubbed each operation and failed on any cleanup after it. Here the real
    // operation runs on a scripted page: execute_job must run exactly the scripts the
    // bare operation runs on the same session, adding no cleanup after success.
    for (kind, dry_run) in [
        ("digest", false),
        ("retrieval", false),
        ("engagement", false),
        ("engagement", true),
    ] {
        let env = Env::new();
        let job_id = enqueue(&env.queue, kind, "OwnedSettlement");
        let mut job = job(&env.queue, &job_id);
        if dry_run {
            job.payload.insert("dry_run".to_owned(), json!(true));
        }
        let text = |key: &str| pyjson::str(job.payload.get(key).unwrap());

        let direct = Tab::new(0);
        let direct_page = direct.page();
        let mut session = direct.session(&env.bridge);
        let expected = match kind {
            "digest" => browser_digest::resolve(
                &mut session,
                RECIPIENT_ID,
                ACCOUNT_USERNAME,
                &text("cache_ent_id"),
            )
            .map(|resolution| resolution.to_value()),
            "retrieval" => browser_ingestion::retrieve(&mut session, &text("url"), 1),
            _ => browser_engagement::engage_post(
                &mut session,
                RECIPIENT_ID,
                ACCOUNT_USERNAME,
                &text("post_url"),
                dry_run,
            ),
        }
        .unwrap();

        let tab = Tab::new(0);
        let page = tab.page();
        let mut session = tab.session(&env.bridge);
        let result = execute_job(&job, &mut session, None).unwrap();
        assert_eq!(result, expected, "{kind}");
        assert_eq!(
            page.lock().unwrap().sources,
            direct_page.lock().unwrap().sources,
            "{kind}"
        );
        match kind {
            "digest" => assert_eq!(result["media_ids"], json!(["123"])),
            "engagement" => assert_eq!(
                result["status"],
                json!(if dry_run { "ready" } else { "succeeded" })
            ),
            _ => assert_eq!(result["account_username"], json!(ACCOUNT_USERNAME)),
        }
    }
}

#[test]
fn test_successful_query_settlement_proof_is_not_rechecked_by_worker() {
    for kind in ["digest", "retrieval"] {
        let env = Env::new();
        let job_id = enqueue(&env.queue, kind, "QueryOwnedProof");
        let proof_seen = Arc::new(AtomicBool::new(false));
        let cancellations = Arc::new(AtomicUsize::new(0));
        let (seen, cancelled) = (proof_seen.clone(), cancellations.clone());
        let tab = Tab::new(0).hook(move |source, page| {
            if source == scripts::CANCEL_REQUEST {
                cancelled.fetch_add(1, Ordering::SeqCst);
                if seen.load(Ordering::SeqCst) {
                    return Some(Err(BrowserError::session(
                        "Instagram browser request cancellation could not be confirmed",
                    )));
                }
            }
            if source == scripts::REQUEST_STATE && !page.request.is_null() {
                seen.store(true, Ordering::SeqCst);
            }
            None
        });
        let mut session = tab.session(&env.bridge);
        let result = execute_job(&job(&env.queue, &job_id), &mut session, None).unwrap();
        assert!(proof_seen.load(Ordering::SeqCst), "{kind}");
        // Each request's own cleanup before it starts; none after its settled result
        // (activating the digest's account cancels once more than Python's stub did).
        assert_eq!(
            cancellations.load(Ordering::SeqCst),
            if kind == "digest" { 2 } else { 1 },
            "{kind}"
        );
        if kind == "digest" {
            assert_eq!(result["media_ids"], json!(["123"]));
        } else {
            assert_eq!(
                result["posts"][0]["url"],
                json!("https://www.instagram.com/p/QueryOwnedProof/")
            );
        }
    }
}

#[test]
fn test_execute_job_cleans_up_on_every_failed_exit() {
    let errors: [(&str, BrowserError); 4] = [
        ("KeyboardInterrupt/SystemExit", BrowserError::Interrupted),
        (
            "TimeoutError",
            BrowserError::Timeout("timed out".to_owned()),
        ),
        (
            "RuntimeError",
            BrowserError::other("RuntimeError", "failed"),
        ),
        ("BrowserSessionError", BrowserError::session("failed")),
    ];
    for kind in ["retrieval", "digest", "engagement"] {
        for (name, error) in &errors {
            let env = Env::new();
            let job_id = enqueue(&env.queue, kind, "FailedExit");
            let failed_at = Arc::new(AtomicBool::new(false));
            let after_failure = Arc::new(AtomicUsize::new(0));
            let (failing, cleaned) = (failed_at.clone(), after_failure.clone());
            let (navigation_failure, failing_navigation) = (error.clone(), failed_at.clone());
            let operation_failure = error.clone();
            let tab = Tab::new(0)
                .hook(move |source, _| {
                    if source == scripts::CANCEL_REQUEST && failing.load(Ordering::SeqCst) {
                        cleaned.fetch_add(1, Ordering::SeqCst);
                    }
                    if source == scripts::CURRENT_ACCOUNT_USERNAME {
                        failing.store(true, Ordering::SeqCst);
                        return Some(Err(operation_failure.clone()));
                    }
                    None
                })
                .on_navigate(move |_, _, _| {
                    failing_navigation.store(true, Ordering::SeqCst);
                    Some(Err(navigation_failure.clone()))
                });
            let mut session = tab.session(&env.bridge);
            let raised = execute_job(&job(&env.queue, &job_id), &mut session, None).unwrap_err();
            let case = format!("{kind} {name}");
            assert!(failed_at.load(Ordering::SeqCst), "{case}");
            // A digest reports session failures as its own session subclass.
            assert_eq!(
                raised.is_session(),
                error.is_session(),
                "{case}: {raised:?}"
            );
            if !error.is_session() {
                assert_eq!(raised.type_name(), error.type_name(), "{case}: {raised:?}");
            }
            assert_eq!(after_failure.load(Ordering::SeqCst), 1, "{case}");
        }
    }
}

#[test]
fn test_failed_cleanup_does_not_swallow_shutdown_interrupt() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    let interrupted = Arc::new(AtomicBool::new(false));
    let tab = Tab::new(0).hook(move |source, _| {
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            interrupted.store(true, Ordering::SeqCst);
            return Some(Err(BrowserError::Interrupted));
        }
        if source == scripts::CANCEL_REQUEST && interrupted.load(Ordering::SeqCst) {
            return Some(Err(BrowserError::session(
                "Instagram browser request cancellation could not be confirmed",
            )));
        }
        None
    });
    let mut session = tab.session(&env.bridge);
    assert!(matches!(
        execute_job(&job(&env.queue, &job_id), &mut session, None),
        Err(BrowserError::Interrupted)
    ));
}

#[test]
fn test_second_worker_cannot_recover_or_claim_the_first_workers_jobs() {
    let env = Env::new();
    let checks = Checks::default();
    let check = checks.clone();
    let pool = env
        .pool()
        .settle(move || Err(check.fail("Worker is not singleton")));
    let worker = env.worker(pool, never(&checks, "Worker is not singleton"));
    let held = lock_file(&env.queue.state_directory.join("worker.lock"));
    held.try_lock_exclusive()
        .expect("test holds the worker lock");
    let result = worker.run(true, true, Arc::new(Event::default()));
    assert!(
        matches!(&result, Err(error) if error.type_name() == "RuntimeError"
            && error.to_string().contains("already running")),
        "{result:?}"
    );
    checks.assert_none();
}

#[test]
fn test_once_recovers_under_browser_lock_and_never_starts_collection() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "Post1");
    assert_eq!(
        env.queue.claim_next(None, true).unwrap().unwrap().id,
        job_id
    );
    let calls = Arc::new(Mutex::new(Vec::new()));
    let checks = Checks::default();
    let (recorded, check, lock_path) = (calls.clone(), checks.clone(), env.lock_path());
    // Recovery settles the tabs and then recovers the queue, both under the lock.
    let pool = env.pool().settle(move || {
        check.check(lock_is_held(&lock_path), "recovery holds the browser lock");
        recorded.lock().unwrap().push("recover");
        Ok(Vec::new())
    });
    let worker = env.worker(pool, never(&checks, "The interrupted engagement pauses"));
    worker.run(true, true, Arc::new(Event::default())).unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["recover"]);
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert_eq!(worker_running(&env.queue), json!(false));
    // No source poller ran: none of them recorded a collection.
    for key in [
        "source_status",
        "profile_queue_status",
        "diagnostics_status",
    ] {
        assert_eq!(setting(&env.queue, key), None, "{key}");
    }
    checks.assert_none();
}

#[test]
fn test_collector_source_failure_is_sanitized_and_retried() {
    // The carousel sync has no seam (it needs Postgres); a worker without a database
    // fails every collection, which shows the same sanitizing and retrying.
    let env = Env::new();
    overrides::instagram_browser(|control| control.source_poll_interval_seconds = 0.01);
    let worker = env.worker(env.pool(), returning(Value::Null));
    let ((), logs) = capture_logs(|| {
        worker.collect("source_status", || {
            Err(anyhow::anyhow!("private database credentials"))
        })
    });
    assert_eq!(
        setting(&env.queue, "source_status").unwrap()["error"],
        json!("RuntimeError")
    );
    assert!(!logs.contains("private database credentials"), "{logs}");

    env.queue.set_setting("source_status", Value::Null).unwrap();
    let stopping = Arc::new(Event::default());
    let pollers = worker.source_pollers(stopping.clone());
    let checked_at = || {
        setting(&env.queue, "source_status")
            .and_then(|status| status.get("checked_at").and_then(Value::as_f64))
    };
    assert!(wait_until(|| checked_at().is_some()));
    let first = checked_at().unwrap();
    env.host.advance(1.0);
    // The failed collection is tried again on the next poll.
    assert!(wait_until(|| checked_at().is_some_and(|at| at > first)));
    stopping.set();
    for poller in pollers {
        poller.join().unwrap();
    }
}

#[test]
fn test_ten_retrievals_overlap_and_release_lock_only_after_cleanup() {
    let env = Env::new();
    let ids: Vec<String> = (0..11)
        .map(|index| retrieval(&env.queue, &format!("Post{index}")))
        .collect();
    let barrier = Barrier::new(10);
    let cleaned = Arc::new(Mutex::new(Vec::new()));
    let checks = Checks::default();
    let cleaned_by = cleaned.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        (0..10)
            .map(|index| {
                let cleaned = cleaned_by.clone();
                Tab::new(index).hook(move |source, _| {
                    if source == scripts::CANCEL_REQUEST {
                        cleaned.lock().unwrap().push(index);
                    }
                    None
                })
            })
            .collect()
    });
    let (check, lock_path) = (checks.clone(), env.lock_path());
    let worker = env.worker(
        pool,
        settling(move |job, _| {
            let url = pyjson::str(&job.payload["url"]);
            if !url.ends_with("/Post10/") {
                check.check(barrier.wait(), "ten reads overlap");
            }
            check.check(lock_is_held(&lock_path), "reads hold the browser lock");
            Ok(json!({"target_url": url, "account_username": ACCOUNT_USERNAME}))
        }),
    );
    assert!(worker.process_next_job(true).unwrap());
    checks.assert_none();
    let states: Vec<String> = ids.iter().map(|id| job(&env.queue, id).state).collect();
    assert_eq!(
        states.iter().filter(|state| *state == "succeeded").count(),
        11
    );
    assert_eq!(states.iter().filter(|state| *state == "pending").count(), 0);
    let cleaned = cleaned.lock().unwrap().clone();
    assert_eq!(
        cleaned.iter().copied().collect::<HashSet<_>>(),
        (0..10).collect()
    );
    assert_eq!(cleaned.len(), 11);
    assert!(!lock_is_held(&env.lock_path()));
}

#[test]
fn test_parallel_native_challenge_guard_pauses_queue_and_settles_each_tab() {
    let env = Env::new();
    let ids: Vec<String> = (0..2)
        .map(|index| retrieval(&env.queue, &format!("Challenge{index}")))
        .collect();
    let cleaned = Arc::new(AtomicUsize::new(0));
    let cleaned_by = cleaned.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        (0..2)
            .map(|index| {
                let cleaned = cleaned_by.clone();
                Tab::new(index)
                    .hook(move |source, _| {
                        if source == scripts::CANCEL_REQUEST {
                            cleaned.fetch_add(1, Ordering::SeqCst);
                        }
                        None
                    })
                    .on_navigate(|_, _, _| {
                        Some(Err(BrowserError::session(
                            "Instagram browser requires human account recovery",
                        )))
                    })
            })
            .collect()
    });
    let worker = env.real_worker(pool);
    assert!(worker.process_next_job(true).unwrap());
    assert!(ids.iter().all(|id| job(&env.queue, id).state == "failed"));
    assert!(paused_text(&env.queue).contains("human account recovery"));
    assert_eq!(cleaned.load(Ordering::SeqCst), 2);
    assert!(!worker.process_next_job(true).unwrap());
}

#[test]
fn test_native_rate_limit_holds_browser_without_a_human_pause_or_action_retry() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "NativeRateLimited");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::rate_limited(
            "Instagram browser is rate limited (HTTP 429)",
        ))
    });
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &job_id).state, "failed");
    assert_eq!(job(&env.queue, &job_id).attempts, 1);
    assert!(env.queue.is_rate_limited(None, false).unwrap());
    assert!(!is_paused(&env.queue));
    let digest_id = digest(&env.queue, "wait-for-rate-limit");
    assert!(!worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &digest_id).state, "pending");
    assert_eq!(job(&env.queue, &job_id).state, "failed");
}

#[test]
fn test_rate_limit_stops_refills_before_failed_operation_cleanup_finishes() {
    let env = Env::new();
    overrides::instagram_browser(|control| control.parallel_tabs = 3);
    let job_ids: Vec<String> = (0..2)
        .map(|index| retrieval(&env.queue, &format!("Cooldown{index}")))
        .collect();
    let cleanup_started = Arc::new(Event::default());
    let release_cleanup = Arc::new(Event::default());
    let extra = Arc::new(Mutex::new(Vec::new()));
    let checks = Checks::default();
    let (started, released) = (cleanup_started.clone(), release_cleanup.clone());
    let check = checks.clone();
    let tabs = Mutex::new(Some(vec![
        // The real retrieval sees Instagram's 429 on the page, then cleans up slowly.
        Tab::new(0).secondary().hook(move |source, _| {
            if source == scripts::PAGE_RESPONSE {
                return Some(Ok(
                    json!({"path": "/p/Cooldown0/", "rate_limited": true}).to_string()
                ));
            }
            if source == scripts::CANCEL_REQUEST {
                started.set();
                check.check(
                    released.wait(5.0),
                    "Coordinator must release the test cleanup",
                );
            }
            None
        }),
        Tab::new(1).secondary(),
    ]));
    let bridge = env.bridge.clone();
    let pool = env.pool().prepare(move |_, _| {
        let tabs = tabs.lock().unwrap().take().expect("prepared once");
        Ok((
            tabs.into_iter().map(|tab| tab.session(&bridge)).collect(),
            ACCOUNT_USERNAME.to_owned(),
        ))
    });
    let (queue, started, added, check) = (
        env.queue.clone(),
        cleanup_started.clone(),
        extra.clone(),
        checks.clone(),
    );
    let worker = env.worker(pool, move |job, session, on_rate_limit| {
        if index_of(session) == 0 {
            return execute_job(job, session, on_rate_limit);
        }
        check.check(started.wait(5.0), "cleanup started");
        let mut added = added.lock().unwrap();
        if added.is_empty() {
            added.push(retrieval(&queue, "DoNotRefillDuringCleanup"));
        }
        Ok(json!({"account_username": ACCOUNT_USERNAME, "posts": []}))
    });
    // Python observed on the coordinator's second wait; here an observer waits for the
    // healthy read's completion to be recorded, gives the coordinator time to refill,
    // then observes and releases the cleanup.
    let observations = Arc::new(Mutex::new(Vec::new()));
    let observer = {
        let (queue, ids, extra, seen, release) = (
            env.queue.clone(),
            job_ids.clone(),
            extra.clone(),
            observations.clone(),
            release_cleanup.clone(),
        );
        std::thread::spawn(move || {
            wait_until(|| job(&queue, &ids[1]).state == "succeeded");
            std::thread::sleep(Duration::from_millis(100));
            let extra = extra.lock().unwrap().first().cloned();
            seen.lock().unwrap().push((
                queue.is_rate_limited(None, true).unwrap(),
                extra.map(|id| job(&queue, &id).attempts),
                job(&queue, &ids[0]).state,
            ));
            release.set();
        })
    };
    let processed = worker.process_next_job(true);
    release_cleanup.set();
    observer.join().unwrap();
    assert!(processed.unwrap());
    checks.assert_none();
    assert_eq!(
        *observations.lock().unwrap(),
        vec![(true, Some(0), "running".to_owned())]
    );
    let extra = extra.lock().unwrap()[0].clone();
    assert_eq!(job(&env.queue, &extra).state, "pending");
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_tab_maintenance_does_not_request_bootstrap_pages_during_cooldown() {
    let env = Env::new();
    engagement(&env.queue, "MaintenanceCooldown");
    let claimed = env.queue.claim_next(None, true).unwrap().unwrap();
    env.queue
        .defer_for_rate_limit(
            Some(&claimed),
            "Instagram browser is rate limited (HTTP 429)",
        )
        .unwrap();
    let checks = Checks::default();
    let check = checks.clone();
    let pool = env
        .pool()
        .ensure(move || Err(check.fail("Cooldown must suppress browser maintenance")));
    let worker = env.worker(pool, never(&checks, "No job runs"));
    assert!(!worker.maintain_tab_pool().unwrap());
    assert!(env.queue.is_rate_limited(None, false).unwrap());
    assert!(!is_paused(&env.queue));
    checks.assert_none();
}

/// Ported from main's d7a63615e: a page that has not laid out yet settles by itself.
#[test]
fn test_a_viewport_that_is_not_ready_defers_maintenance_without_pausing() {
    let env = Env::new();
    let pool = env.pool().ensure(|| {
        Err(BrowserError::page_unavailable(
            "Instagram browser viewport did not become ready",
        ))
    });
    let worker = env.real_worker(pool);
    let (maintained, logs) = capture_logs(|| worker.maintain_tab_pool());
    assert!(!maintained.unwrap());
    assert!(!is_paused(&env.queue));
    assert!(
        logs.contains("Tab maintenance deferred: Instagram browser viewport did not become ready"),
        "{logs}"
    );
}

/// Startup recovery treats unready worker tabs the same way: they are repaired before
/// the next job instead of pausing every school.
#[test]
fn test_unready_worker_tabs_at_startup_recover_without_pausing() {
    let env = Env::new();
    // An interrupted read is safe to retry once the tabs are repaired.
    let job_id = digest(&env.queue, "unready-startup");
    env.queue.claim_next(None, true).unwrap().unwrap();
    let pool = env.pool().settle(|| {
        Err(BrowserError::page_unavailable(
            "Instagram browser viewport did not become ready",
        ))
    });
    let worker = env.real_worker(pool);
    let (recovered, logs) = capture_logs(|| worker.recover_worker_queue());
    recovered.unwrap();
    assert!(!is_paused(&env.queue));
    assert_eq!(job(&env.queue, &job_id).state, "pending");
    assert!(
        logs.contains("Worker tabs are not ready yet (Instagram browser viewport did not become ready); they are repaired before the next job"),
        "{logs}"
    );
}

#[test]
fn test_fresh_maintenance_429_uses_shared_cooldown_without_a_human_pause() {
    let env = Env::new();
    let pool = env.pool().ensure(|| {
        Err(BrowserError::rate_limited(
            "Instagram browser is rate limited (HTTP 429)",
        ))
    });
    let worker = env.real_worker(pool);
    assert!(!worker.maintain_tab_pool().unwrap());
    assert!(env.queue.is_rate_limited(None, false).unwrap());
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_settled_rate_limited_read_refunds_behind_an_independent_human_pause() {
    for kind in ["retrieval", "digest"] {
        let env = Env::new();
        overrides::instagram_browser(|control| control.parallel_tabs = 3);
        let job_ids: Vec<String> = (0..2)
            .map(|index| enqueue(&env.queue, kind, &format!("PausedRateLimit{index}")))
            .collect();
        let human_error = "Instagram browser account requires human reauthorization";
        let barrier = Barrier::new(2);
        let settlement = Arc::new(Mutex::new(Vec::new()));
        let checks = Checks::default();
        let (queue, ids, settled, check) = (
            env.queue.clone(),
            job_ids.clone(),
            settlement.clone(),
            checks.clone(),
        );
        let pool = env.pool().tabs(&env.bridge, move || {
            let (queue, ids, settled, check) =
                (queue.clone(), ids.clone(), settled.clone(), check.clone());
            vec![
                Tab::new(0).hook(move |source, _| {
                    if source == scripts::CANCEL_REQUEST {
                        check.check(
                            wait_until(|| paused(&queue) == json!(human_error)),
                            "The independent auth failure must pause before read settlement",
                        );
                        check.check(job(&queue, &ids[0]).state == "running", "still running");
                        check.check(job(&queue, &ids[0]).attempts == 1, "one attempt");
                        settled.lock().unwrap().push("settled");
                    }
                    None
                }),
                Tab::new(1),
            ]
        });
        let (ids, check) = (job_ids.clone(), checks.clone());
        let worker = env.worker(
            pool,
            settling(move |job, _| {
                check.check(barrier.wait(), "both reads run");
                if job.id == ids[0] {
                    return Err(BrowserError::rate_limited(
                        "Instagram browser is rate limited (HTTP 429)",
                    ));
                }
                Err(BrowserError::session(human_error))
            }),
        );
        assert!(worker.process_next_job(true).unwrap(), "{kind}");
        checks.assert_none();
        assert_eq!(*settlement.lock().unwrap(), vec!["settled"], "{kind}");
        assert_eq!(job(&env.queue, &job_ids[0]).state, "pending", "{kind}");
        assert_eq!(job(&env.queue, &job_ids[0]).attempts, 0, "{kind}");
        assert_eq!(job(&env.queue, &job_ids[1]).state, "failed", "{kind}");
        assert_eq!(paused(&env.queue), json!(human_error), "{kind}");
        assert!(env.queue.is_rate_limited(None, true).unwrap(), "{kind}");
        assert_eq!(env.queue.claim_next(None, true).unwrap(), None, "{kind}");
        assert_eq!(
            env.queue
                .claim_companions(&job(&env.queue, &job_ids[0]), 1, true)
                .unwrap(),
            Vec::<BrowserJob>::new(),
            "{kind}"
        );
    }
}

#[test]
fn test_last_budget_rate_limit_refunds_only_after_cleanup_then_real_failure_exhausts_budget() {
    for kind in ["retrieval", "digest"] {
        let env = Env::new();
        let limit = control().ingestion_retry_limit;
        let job_id = enqueue(&env.queue, kind, "LastBudget429");
        for _ in 0..limit - 1 {
            let claimed = env.queue.claim_next(None, true).unwrap().unwrap();
            env.queue
                .finish(
                    &claimed,
                    Finish {
                        error: Some("A previous ordinary read failure".to_owned()),
                        requeue: true,
                        ..Finish::default()
                    },
                )
                .unwrap();
        }
        let attempts_during_cleanup = Arc::new(Mutex::new(Vec::new()));
        let (queue, id, attempts) = (
            env.queue.clone(),
            job_id.clone(),
            attempts_during_cleanup.clone(),
        );
        let pool = env.pool().tabs(&env.bridge, move || {
            let (queue, id, attempts) = (queue.clone(), id.clone(), attempts.clone());
            vec![Tab::new(0).hook(move |source, _| {
                if source == scripts::CANCEL_REQUEST {
                    attempts.lock().unwrap().push(job(&queue, &id).attempts);
                }
                None
            })]
        });
        let worker = env.worker(
            pool.clone(),
            settling(|_, _| {
                Err(BrowserError::rate_limited(
                    "Instagram public media request failed with HTTP 429",
                ))
            }),
        );
        assert!(worker.process_next_job(true).unwrap(), "{kind}");
        assert_eq!(
            *attempts_during_cleanup.lock().unwrap(),
            vec![limit],
            "{kind}"
        );
        assert_eq!(job(&env.queue, &job_id).state, "pending", "{kind}");
        assert_eq!(job(&env.queue, &job_id).attempts, limit - 1, "{kind}");
        assert!(
            env.queue
                .is_rate_limited(None, kind == "retrieval")
                .unwrap(),
            "{kind}"
        );
        let scope = if kind == "retrieval" {
            "retrieval"
        } else {
            "browser"
        };
        env.queue
            .set_setting(&format!("{scope}_rate_limit_until"), json!(0))
            .unwrap();

        let worker = env.worker(
            pool,
            settling(|_, _| {
                Err(BrowserError::page_unavailable(
                    "Instagram public media response did not contain a media list",
                ))
            }),
        );
        assert!(worker.process_next_job(true).unwrap(), "{kind}");
        assert_eq!(job(&env.queue, &job_id).state, "failed", "{kind}");
        assert_eq!(job(&env.queue, &job_id).attempts, limit, "{kind}");
        assert!(!is_paused(&env.queue), "{kind}");
    }
}

#[test]
fn test_source_collectors_continue_while_browser_claims_are_rate_limited() {
    // Without a database each collector fails at once; each still runs and records its
    // status while browser claims are held for a rate limit.
    let env = Env::new();
    engagement(&env.queue, "SourcesCooldown");
    let claimed = env.queue.claim_next(None, true).unwrap().unwrap();
    env.queue
        .defer_for_rate_limit(
            Some(&claimed),
            "Instagram browser is rate limited (HTTP 429)",
        )
        .unwrap();
    let worker = env.worker(env.pool(), returning(Value::Null));
    let stopping = Arc::new(Event::default());
    let pollers = worker.source_pollers(stopping.clone());
    let collected = wait_until(|| {
        [
            "profile_queue_status",
            "diagnostics_status",
            "source_status",
        ]
        .iter()
        .all(|key| setting(&env.queue, key).is_some())
    });
    stopping.set();
    for poller in pollers {
        poller.join().unwrap();
    }
    assert!(collected);
    assert!(env.queue.is_rate_limited(None, false).unwrap());
}

#[test]
fn test_digest_loading_account_route_does_not_pause() {
    let env = Env::new();
    let ids: Vec<String> = (0..2)
        .map(|index| digest(&env.queue, &format!("transient-login-{index}")))
        .collect();
    let pages = Arc::new(Mutex::new(Vec::new()));
    let recorded = pages.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        (0..2)
            .map(|index| {
                let mut paths = vec!["/accounts/", "/"].into_iter();
                let tab = Tab::new(index).hook(move |source, page| {
                    if source == scripts::PAGE_RESPONSE {
                        page.path = paths.next().unwrap_or("/").to_owned();
                    }
                    None
                });
                recorded.lock().unwrap().push(tab.page());
                tab
            })
            .collect()
    });
    let worker = env.worker(pool, returning(json!({"status": "succeeded"})));
    assert!(worker.process_next_job(true).unwrap());
    assert!(
        ids.iter()
            .all(|id| job(&env.queue, id).state == "succeeded")
    );
    assert!(!is_paused(&env.queue));
    // Readiness was false on the account route, then true.
    for page in pages.lock().unwrap().iter() {
        let page = page.lock().unwrap();
        let reads = page
            .sources
            .iter()
            .filter(|source| *source == scripts::PAGE_RESPONSE)
            .count();
        assert_eq!(reads, 2);
    }
}

#[test]
fn test_fast_tab_refills_before_slow_tab_finishes() {
    let env = Env::new();
    let ids: Vec<String> = (0..11)
        .map(|index| retrieval(&env.queue, &format!("Stream{index}")))
        .collect();
    let refilled = Arc::new(Event::default());
    let checks = Checks::default();
    let (queue, job_ids, refill, check) = (
        env.queue.clone(),
        ids.clone(),
        refilled.clone(),
        checks.clone(),
    );
    let worker = env.worker(env.pool(), move |job, _, _| {
        if job.id == job_ids[0] {
            check.check(
                refill.wait(5.0),
                "Fast tabs must refill while the first tab remains busy",
            );
        }
        if job.id == job_ids[10] {
            check.check(
                job_state(&queue, &job_ids[0]) == "running",
                "first still running",
            );
            refill.set();
        }
        Ok(json!({"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}))
    });
    assert!(worker.process_next_job(true).unwrap());
    checks.assert_none();
    assert!(
        ids.iter()
            .all(|id| job(&env.queue, id).state == "succeeded")
    );
}

#[test]
fn test_blank_first_target_does_not_prevent_other_slots_visiting_their_own_targets() {
    let env = Env::new();
    // Python's readiness poll failed at once; the real poll waits out the interaction
    // timeout, kept short here.
    overrides::instagram_browser(|control| control.interaction_timeout_seconds = 2.0);
    let bad_url = "https://www.instagram.com/p/BlankFirst/";
    let good_url = "https://www.instagram.com/p/HealthySecond/";
    let ids = [
        retrieval(&env.queue, "BlankFirst"),
        retrieval(&env.queue, "HealthySecond"),
    ];
    let navigations = Arc::new(Mutex::new(Vec::new()));
    let queries = Arc::new(Mutex::new(Vec::new()));
    let (navigated, queried, bridge) = (navigations.clone(), queries.clone(), env.bridge.clone());
    let pool = env.pool().prepare(move |job, _| {
        let mut sessions: Vec<BrowserInstagramSession> = (0..2)
            .map(|index| {
                let (navigated, queried) = (navigated.clone(), queried.clone());
                Tab::new(index)
                    .at("/p/BlankFirst/")
                    .hook(move |source, page| {
                        if source == scripts::CURRENT_ACCOUNT_USERNAME {
                            let blank = page.path == "/p/BlankFirst/";
                            return Some(Ok(if blank { "" } else { ACCOUNT_USERNAME }.to_owned()));
                        }
                        if source.contains(scripts::REQUEST_KEY)
                            && source != scripts::CANCEL_REQUEST
                            && source != scripts::CLEAR_REQUEST
                            && source != scripts::REQUEST_STATE
                        {
                            queried
                                .lock()
                                .unwrap()
                                .push(format!("https://www.instagram.com{}", page.path));
                        }
                        None
                    })
                    .on_navigate(move |url, _, _| {
                        navigated.lock().unwrap().push((index, url.to_owned()));
                        None
                    })
                    .session(&bridge)
            })
            .collect();
        // Reproduce the old pool broadcast. A slot must reach its own target before
        // waiting for that target's readiness, even after this stale page.
        let url = pyjson::str(&job.payload["url"]);
        for session in &mut sessions {
            session.navigate(&url, true)?;
        }
        Ok((sessions, ACCOUNT_USERNAME.to_owned()))
    });
    let worker = env.real_worker(pool);
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &ids[1]).state, "succeeded");
    assert_eq!(job(&env.queue, &ids[1]).attempts, 1);
    assert_eq!(job(&env.queue, &ids[0]).state, "failed");
    assert_eq!(
        job(&env.queue, &ids[0]).attempts,
        control().ingestion_retry_limit
    );
    assert!(queries.lock().unwrap().contains(&good_url.to_owned()));
    assert!(
        navigations
            .lock()
            .unwrap()
            .contains(&(1, good_url.to_owned()))
    );
    assert!(!navigations.lock().unwrap().is_empty());
    assert!(!queries.lock().unwrap().contains(&bad_url.to_owned()));
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_retrieval_refill_reloads_its_exact_target_before_owned_readiness() {
    let env = Env::new();
    let urls: Vec<String> = (0..2)
        .map(|index| format!("https://www.instagram.com/p/RefillTarget{index}/"))
        .collect();
    let ids = Arc::new(Mutex::new(vec![retrieval(&env.queue, "RefillTarget0")]));
    let (queue, added) = (env.queue.clone(), ids.clone());
    let tab = Tab::new(0).at("/p/Stale/").hook(move |source, page| {
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            let known = page.path.starts_with("/p/RefillTarget");
            return Some(Ok(if known { ACCOUNT_USERNAME } else { "" }.to_owned()));
        }
        let query = source.contains(scripts::REQUEST_KEY)
            && ![
                scripts::CANCEL_REQUEST,
                scripts::CLEAR_REQUEST,
                scripts::REQUEST_STATE,
            ]
            .contains(&source);
        if query && page.path == "/p/RefillTarget0/" {
            added
                .lock()
                .unwrap()
                .push(retrieval(&queue, "RefillTarget1"));
        }
        None
    });
    let page = tab.page();
    let session = Mutex::new(Some(tab.session(&env.bridge)));
    let pool = env.pool().prepare(move |_, _| {
        let session = session.lock().unwrap().take().expect("prepared once");
        Ok((vec![session], ACCOUNT_USERNAME.to_owned()))
    });
    let worker = env.real_worker(pool);
    assert!(worker.process_next_job(true).unwrap());
    let page = page.lock().unwrap();
    assert_eq!(
        page.navigations,
        urls.iter()
            .map(|url| (url.clone(), true))
            .collect::<Vec<_>>()
    );
    let queried: Vec<String> = page
        .queries
        .iter()
        .map(|path| format!("https://www.instagram.com{path}"))
        .collect();
    assert_eq!(queried, urls);
    // Each query settles its predecessor before starting; nothing cleans up after a
    // successful query.
    assert_eq!(page.cancels, 2);
    for id in ids.lock().unwrap().iter() {
        assert_eq!(job(&env.queue, id).state, "succeeded");
        assert_eq!(job(&env.queue, id).attempts, 1);
    }
}

#[test]
fn test_unverified_retrieval_identity_never_reaches_queue_results() {
    for result in [
        Value::Null,
        json!({}),
        json!({"account_username": null}),
        json!({"account_username": []}),
        json!({"account_username": "untrusted response text"}),
        json!({"account_username": "wat2do.other"}),
    ] {
        let env = Env::new();
        let job_id = retrieval(&env.queue, "UnverifiedIdentity");
        env.queue
            .set_setting("retrieval_pool_account", json!(ACCOUNT_USERNAME))
            .unwrap();
        let checks = Checks::default();
        let check = checks.clone();
        let pool = env.pool().tabs(&env.bridge, move || {
            let check = check.clone();
            vec![Tab::new(0).hook(move |source, _| {
                (source == scripts::PAGE_RESPONSE)
                    .then(|| Err(check.fail("Retrieval readiness belongs to its target owner")))
            })]
        });
        let worker = env.worker(pool, returning(result.clone()));
        assert!(worker.process_next_job(true).unwrap(), "{result}");
        checks.assert_none();
        let stored = job(&env.queue, &job_id);
        assert_eq!(stored.state, "pending", "{result}");
        assert_eq!(stored.result, None, "{result}");
        assert_eq!(stored.attempts, 1, "{result}");
        assert_eq!(
            setting(&env.queue, "retrieval_pool_account").unwrap_or(Value::Null),
            Value::Null,
            "{result}"
        );
        assert!(!is_paused(&env.queue), "{result}");
    }
}

#[test]
fn test_public_retrieval_keeps_a_verified_personal_account_context() {
    let env = Env::new();
    let job_id = retrieval(&env.queue, "PersonalContext");
    let bridge = env.bridge.clone();
    let pool = env.pool().prepare(move |_, _| {
        Ok((
            vec![Tab::new(0).session(&bridge)],
            "student.personal".to_owned(),
        ))
    });
    let worker = env.worker(
        pool,
        returning(json!({"account_username": "student.personal", "posts": []})),
    );
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &job_id).state, "succeeded");
}

#[test]
fn test_target_auth_redirect_pauses_before_any_media_query_or_publication() {
    for redirect in [
        "/accounts/login/",
        "/accounts/suspended/",
        "/challenge/",
        "/checkpoint/",
    ] {
        let env = Env::new();
        let job_id = retrieval(&env.queue, "AuthRedirect");
        let checks = Checks::default();
        let check = checks.clone();
        let tab = Tab::new(0)
            .at(&format!("/{ACCOUNT_USERNAME}/"))
            .hook(move |source, _| {
                let expected = [
                    scripts::PAGE_RESPONSE,
                    scripts::CANCEL_REQUEST,
                    scripts::CLEAR_REQUEST,
                ];
                (!expected.contains(&source)).then(|| {
                    Err(check.fail("An auth redirect must fail before public media queries"))
                })
            })
            .on_navigate(move |_, _, page| {
                page.path = redirect.to_owned();
                Some(Ok("navigating".to_owned()))
            });
        let page = tab.page();
        let session = Mutex::new(Some(tab.session(&env.bridge)));
        let pool = env.pool().prepare(move |_, _| {
            let session = session.lock().unwrap().take().expect("prepared once");
            Ok((vec![session], ACCOUNT_USERNAME.to_owned()))
        });
        let worker = env.real_worker(pool);
        assert!(worker.process_next_job(true).unwrap(), "{redirect}");
        checks.assert_none();
        let stored = job(&env.queue, &job_id);
        let page = page.lock().unwrap();
        assert_eq!(
            page.navigations,
            vec![(pyjson::str(&stored.payload["url"]), true)],
            "{redirect}"
        );
        assert_eq!(stored.state, "failed", "{redirect}");
        assert_eq!(stored.result, None, "{redirect}");
        assert!(
            paused_text(&env.queue).contains("human account recovery"),
            "{redirect}"
        );
        assert_eq!(page.cancels, 1, "{redirect}");
    }
}

#[test]
fn test_stream_uses_idle_tabs_for_jobs_arriving_after_start() {
    let env = Env::new();
    let first = retrieval(&env.queue, "First");
    let arrived = Arc::new(Event::default());
    let checks = Checks::default();
    let pool = env
        .pool()
        .tabs(&env.bridge, || (0..13).map(Tab::new).collect());
    let (queue, first_id, arrival, check) = (
        env.queue.clone(),
        first.clone(),
        arrived.clone(),
        checks.clone(),
    );
    let worker = env.worker(pool, move |job, _, _| {
        if job.id == first_id {
            retrieval(&queue, "Arriving");
            check.check(
                arrival.wait(5.0),
                "Idle tab must start the arriving job before the first finishes",
            );
        } else {
            check.check(
                job_state(&queue, &first_id) == "running",
                "first still running",
            );
            arrival.set();
        }
        Ok(json!({"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}))
    });
    assert!(worker.process_next_job(true).unwrap());
    checks.assert_none();
    assert!(arrived.is_set());
}

#[test]

fn test_retrieval_stream_keeps_refilling_past_one_job_timeout() {
    let env = Env::new();
    overrides::instagram_browser(|control| control.job_timeout_seconds = 0.01);
    let first = retrieval(&env.queue, "LongStream");
    let later = Arc::new(Mutex::new(Vec::new()));
    let pool = env.pool().tabs(&env.bridge, || vec![Tab::new(0)]);
    let (queue, host, added) = (env.queue.clone(), env.host.clone(), later.clone());
    let worker = env.worker(pool, move |job, _, _| {
        if job.id == first {
            added.lock().unwrap().push(retrieval(&queue, "AfterTimer"));
            // Python slept 0.02 seconds of real time; the deadline runs on the virtual clock.
            host.advance(0.02);
        }
        Ok(json!({"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}))
    });
    assert!(worker.process_next_job(true).unwrap());
    let later = later.lock().unwrap()[0].clone();
    assert_eq!(job(&env.queue, &later).state, "succeeded");
}

#[test]
fn test_manual_account_switch_drains_before_bounded_retry() {
    for persistent in [false, true] {
        for kind in ["retrieval", "digest"] {
            let env = Env::new();
            let case = format!("{kind} persistent={persistent}");
            let ids: Vec<String> = (0..2)
                .map(|index| {
                    if kind == "retrieval" {
                        retrieval(&env.queue, &format!("Changed{index}"))
                    } else {
                        digest(&env.queue, &format!("changed-cache-{index}"))
                    }
                })
                .collect();
            let drained = Arc::new(Event::default());
            let mismatched = Arc::new(Event::default());
            let preparations = Arc::new(AtomicUsize::new(0));
            let executions = Arc::new(Mutex::new(Vec::new()));
            let checks = Checks::default();
            let (queue, bridge, check) = (env.queue.clone(), env.bridge.clone(), checks.clone());
            let (drain, mismatch, prepared, first) = (
                drained.clone(),
                mismatched.clone(),
                preparations.clone(),
                ids[0].clone(),
            );
            let pool = env.pool().prepare(move |_, _| {
                let preparation = prepared.fetch_add(1, Ordering::SeqCst) + 1;
                if preparation > 1 {
                    check.check(drain.is_set(), "drained before the retry");
                    check.check(
                        setting(&queue, "retrieval_pool_account")
                            .unwrap_or(Value::Null)
                            .is_null(),
                        "pool account cleared",
                    );
                }
                let sessions = (0..2)
                    .map(|index| {
                        let (queue, check, drain, mismatch, first) = (
                            queue.clone(),
                            check.clone(),
                            drain.clone(),
                            mismatch.clone(),
                            first.clone(),
                        );
                        Tab::new(index)
                            .hook(move |source, _| {
                                if source == scripts::CURRENT_ACCOUNT_USERNAME {
                                    if persistent || (index == 0 && preparation == 1) {
                                        mismatch.set();
                                        return Some(Ok("wat2do.uwaterloo".to_owned()));
                                    }
                                    if preparation == 1 {
                                        check.check(mismatch.wait(5.0), "mismatch seen");
                                    }
                                    return Some(Ok(ACCOUNT_USERNAME.to_owned()));
                                }
                                if source == scripts::CANCEL_REQUEST && index == 1 {
                                    // Python asserted at the requeue that this tab had
                                    // drained: the mismatched job is still running here.
                                    if !drain.is_set() {
                                        check.check(
                                            job(&queue, &first).state == "running",
                                            "Account recovery must wait for every active tab",
                                        );
                                    }
                                    drain.set();
                                }
                                None
                            })
                            .session(&bridge)
                    })
                    .collect();
                Ok((sessions, ACCOUNT_USERNAME.to_owned()))
            });
            let executed = executions.clone();
            let worker = env.worker(
                pool,
                settling(move |job, _| {
                    executed.lock().unwrap().push(job.id.clone());
                    Ok(json!({}))
                }),
            );
            assert!(worker.process_next_job(true).unwrap(), "{case}");
            assert_eq!(job(&env.queue, &ids[0]).state, "pending", "{case}");
            assert_eq!(
                job(&env.queue, &ids[1]).state,
                if persistent { "pending" } else { "succeeded" },
                "{case}"
            );
            let expected: Vec<String> = if kind == "retrieval" {
                ids.clone()
            } else if persistent {
                Vec::new()
            } else {
                vec![ids[1].clone()]
            };
            let mut executed = executions.lock().unwrap().clone();
            executed.sort();
            let mut expected_sorted = expected;
            expected_sorted.sort();
            assert_eq!(executed, expected_sorted, "{case}");
            assert!(!is_paused(&env.queue), "{case}");
            let limit = control().ingestion_retry_limit;
            for _ in 0..(if persistent { limit - 1 } else { 1 }) {
                assert!(worker.process_next_job(true).unwrap(), "{case}");
            }
            let stored = job(&env.queue, &ids[0]);
            assert_eq!(
                stored.state,
                if persistent { "failed" } else { "succeeded" },
                "{case}"
            );
            if persistent {
                assert_eq!(stored.attempts, limit, "{case}");
                let expected = if kind == "retrieval" {
                    "does not match the verified primary account"
                } else {
                    "expected ubc.wat2do.io, found wat2do.uwaterloo"
                };
                assert!(stored.error.unwrap().contains(expected), "{case}");
            }
            assert!(!is_paused(&env.queue), "{case}");
            checks.assert_none();
        }
    }
}

#[test]
fn test_transient_tab_inventory_failure_defers_maintenance_without_pausing() {
    let env = Env::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let pool = env.pool().ensure(move || {
        if counted.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(BrowserError::transient(
                "Brave could not run Instagram browser automation (Apple Event -1719)",
            ));
        }
        Ok(vec!["42".to_owned()])
    });
    let worker = env.real_worker(pool);
    assert!(!worker.maintain_tab_pool().unwrap());
    assert!(!is_paused(&env.queue));
    assert!(worker.maintain_tab_pool().unwrap());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_worker_does_not_claim_during_deferred_tab_maintenance_and_resumes_when_ready() {
    let failures: [fn(&str) -> BrowserError; 2] = [
        |message| BrowserError::transient(message),
        |message| BrowserError::Timeout(message.to_owned()),
    ];
    for failure in failures {
        let env = Env::new();
        let interval = 0.01;
        overrides::instagram_browser(|control| control.worker_poll_interval_seconds = interval);
        let job_id = engagement(&env.queue, "WaitForReadyPool");
        let checks_at = Arc::new(Mutex::new(Vec::new()));
        let executions = Arc::new(Mutex::new(Vec::new()));
        let terminate = Arc::new(Event::default());
        let checks = Checks::default();
        let (queue, host, at, check, id) = (
            env.queue.clone(),
            env.host.clone(),
            checks_at.clone(),
            checks.clone(),
            job_id.clone(),
        );
        let pool = env.pool().ensure(move || {
            let mut at = at.lock().unwrap();
            at.push(host.monotonic());
            if at.len() == 1 {
                return Err(failure(
                    "Browser tab initialization temporarily unavailable",
                ));
            }
            check.check(job(&queue, &id).state == "pending", "pending until ready");
            check.check(job(&queue, &id).attempts == 0, "no attempt until ready");
            check.check(!is_paused(&queue), "not paused");
            Ok(Vec::new())
        });
        let (at, executed, stop, check) = (
            checks_at.clone(),
            executions.clone(),
            terminate.clone(),
            checks.clone(),
        );
        let worker = env.worker(pool, move |job, _, _| {
            check.check(
                at.lock().unwrap().len() == 2,
                "Incomplete tab maintenance must not admit browser jobs",
            );
            executed.lock().unwrap().push(job.id.clone());
            stop.set();
            Ok(json!({"status": "succeeded"}))
        });
        let ticker = Ticker::start(&env.host);
        worker.run(false, false, terminate).unwrap();
        drop(ticker);
        checks.assert_none();
        let at = checks_at.lock().unwrap().clone();
        assert_eq!(at.len(), 2);
        assert!(at[1] - at[0] >= interval);
        assert_eq!(*executions.lock().unwrap(), vec![job_id.clone()]);
        assert_eq!(job(&env.queue, &job_id).state, "succeeded");
        assert_eq!(job(&env.queue, &job_id).attempts, 1);
        assert!(!is_paused(&env.queue));
        assert_eq!(worker_running(&env.queue), json!(false));
    }
}

#[test]
fn test_once_worker_exits_without_claiming_when_tab_maintenance_is_not_ready() {
    let env = Env::new();
    let job_id = engagement(&env.queue, "OnceWaitForReadyPool");
    let pool = env.pool().ensure(|| {
        Err(BrowserError::transient(
            "Browser tab initialization temporarily unavailable",
        ))
    });
    let checks = Checks::default();
    let worker = env.worker(
        pool,
        never(&checks, "Once must leave work pending without a ready pool"),
    );
    worker.run(true, false, Arc::new(Event::default())).unwrap();
    assert_eq!(job(&env.queue, &job_id).state, "pending");
    assert_eq!(job(&env.queue, &job_id).attempts, 0);
    assert!(!is_paused(&env.queue));
    assert_eq!(worker_running(&env.queue), json!(false));
    checks.assert_none();
}

/// A named failure a test operation raises.
type Failure = (&'static str, fn() -> BrowserError);

#[test]
fn test_safe_read_failure_retries_without_pausing_or_exposing_final_failure() {
    let failures: [Failure; 3] = [
        ("_BrowserAutomationTransient", || {
            BrowserError::transient("Recoverable browser read failed")
        }),
        ("_BrowserPageUnavailable", || {
            BrowserError::page_unavailable("Recoverable browser read failed")
        }),
        ("TimeoutError", || {
            BrowserError::Timeout("Recoverable browser read failed".to_owned())
        }),
    ];
    for kind in ["retrieval", "digest"] {
        for (name, failure) in failures {
            let env = Env::new();
            let case = format!("{kind} {name}");
            let job_id = enqueue(&env.queue, kind, "Recoverable");
            let tab = Tab::new(0);
            let page = tab.page();
            let session = Mutex::new(Some(tab));
            let bridge = env.bridge.clone();
            // One session serves every attempt, as Python's single namespace did.
            let pool = env.pool().prepare(move |_, _| {
                let tab = session.lock().unwrap().take();
                let session = match tab {
                    Some(tab) => tab.session(&bridge),
                    None => Tab::new(0).session(&bridge),
                };
                Ok((vec![session], ACCOUNT_USERNAME.to_owned()))
            });
            let calls = Arc::new(AtomicUsize::new(0));
            let counted = calls.clone();
            let worker = env.worker(
                pool,
                settling(move |_, _| {
                    if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                        return Err(failure());
                    }
                    Ok(json!({"status": "succeeded", "account_username": ACCOUNT_USERNAME}))
                }),
            );
            assert!(worker.process_next_job(true).unwrap(), "{case}");
            if kind == "digest" {
                assert_eq!(job(&env.queue, &job_id).state, "pending", "{case}");
                assert_eq!(job(&env.queue, &job_id).error, None, "{case}");
                assert!(worker.process_next_job(true).unwrap(), "{case}");
            }
            assert_eq!(job(&env.queue, &job_id).state, "succeeded", "{case}");
            assert_eq!(job(&env.queue, &job_id).attempts, 2, "{case}");
            let settlements = if kind == "digest" {
                // The second digest attempt prepared a fresh session.
                page.lock().unwrap().cancels + 1
            } else {
                page.lock().unwrap().cancels
            };
            assert_eq!(settlements, 2, "{case}");
            assert!(!is_paused(&env.queue), "{case}");
        }
    }
}

#[test]
fn test_repeated_bridge_failure_has_a_finite_read_retry_budget() {
    for kind in ["retrieval", "digest"] {
        let env = Env::new();
        let job_id = enqueue(&env.queue, kind, "Budget");
        let worker = env.worker(
            env.pool(),
            settling(|_, _| Err(BrowserError::transient("Brave read bridge timed out"))),
        );
        let limit = control().ingestion_retry_limit;
        for _ in 0..limit {
            if job(&env.queue, &job_id).state == "failed" {
                break;
            }
            assert!(worker.process_next_job(true).unwrap(), "{kind}");
        }
        assert_eq!(job(&env.queue, &job_id).state, "failed", "{kind}");
        assert_eq!(job(&env.queue, &job_id).attempts, limit, "{kind}");
        assert!(!is_paused(&env.queue), "{kind}");
    }
}

#[test]
fn test_digest_mismatch_during_query_stays_running_until_other_tab_settles() {
    let env = Env::new();
    let first = digest(&env.queue, "mismatch-query");
    let second = digest(&env.queue, "slow-query");
    let mismatched = Arc::new(Event::default());
    let settled = Arc::new(Event::default());
    let checks = Checks::default();
    let settle = settled.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        (0..2)
            .map(|index| {
                let settle = settle.clone();
                Tab::new(index).hook(move |source, _| {
                    if source == scripts::CANCEL_REQUEST && index == 1 {
                        settle.set();
                    }
                    None
                })
            })
            .collect()
    });
    let (queue, first_id, mismatch, check) = (
        env.queue.clone(),
        first.clone(),
        mismatched.clone(),
        checks.clone(),
    );
    let worker = env.worker(
        pool,
        settling(move |_, session| {
            if index_of(session) == 0 {
                mismatch.set();
                return Err(BrowserError::account_changed(
                    "Instagram account changed during digest query",
                ));
            }
            check.check(mismatch.wait(5.0), "mismatch seen");
            check.check(
                job(&queue, &first_id).state == "running",
                "first still running",
            );
            check.check(
                job(&queue, &first_id).error.is_none(),
                "first has no error yet",
            );
            Ok(json!({"status": "succeeded"}))
        }),
    );
    assert!(worker.process_next_job(true).unwrap());
    checks.assert_none();
    assert!(settled.is_set());
    assert_eq!(job(&env.queue, &first).state, "pending");
    assert_eq!(job(&env.queue, &second).state, "succeeded");
    assert!(
        setting(&env.queue, "retrieval_pool_account")
            .unwrap_or(Value::Null)
            .is_null()
    );
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_aged_engagement_yields_stream_only_after_active_reads_settle() {
    let env = Env::new();
    let first = retrieval(&env.queue, "BeforeYield");
    let engagement_ids = Arc::new(Mutex::new(Vec::new()));
    let later_ids = Arc::new(Mutex::new(Vec::new()));
    let cleaned = Arc::new(Event::default());
    let checks = Checks::default();
    let clean = cleaned.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        let clean = clean.clone();
        vec![Tab::new(0).hook(move |source, _| {
            if source == scripts::CANCEL_REQUEST {
                clean.set();
            }
            None
        })]
    });
    let (queue, host, engagements, later, clean, check) = (
        env.queue.clone(),
        env.host.clone(),
        engagement_ids.clone(),
        later_ids.clone(),
        cleaned.clone(),
        checks.clone(),
    );
    let first_id = first.clone();
    let worker = env.worker(
        pool,
        settling(move |job, _| {
            if job.id == first_id {
                engagements
                    .lock()
                    .unwrap()
                    .push(engagement(&queue, "WaitingFeatured"));
                later.lock().unwrap().push(retrieval(&queue, "AfterYield"));
                host.advance(control().engagement_max_wait_seconds);
            } else if job.kind == "engagement" {
                check.check(clean.is_set(), "reads settled first");
                check.check(job_state(&queue, &first_id) == "succeeded", "read finished");
                let later = later.lock().unwrap()[0].clone();
                check.check(job_state(&queue, &later) == "pending", "later read waits");
            }
            Ok(json!({"status": "succeeded"}))
        }),
    );
    let later = || later_ids.lock().unwrap()[0].clone();
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &later()).state, "pending");
    assert!(worker.process_next_job(true).unwrap());
    let engagement_id = engagement_ids.lock().unwrap()[0].clone();
    assert_eq!(job(&env.queue, &engagement_id).state, "succeeded");
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &later()).state, "succeeded");
    checks.assert_none();
}

fn job_state(queue: &BrowserJobQueue, id: &str) -> String {
    job(queue, id).state
}

#[test]
fn test_worker_heartbeat_continues_while_browser_preparation_blocks() {
    for stage in ["startup", "maintenance", "prepare"] {
        let env = Env::new();
        overrides::instagram_browser(|control| control.worker_poll_interval_seconds = 0.01);
        let entered = Arc::new(Event::default());
        let release = Arc::new(Event::default());
        let failures = Arc::new(Mutex::new(Vec::new()));
        let blocked = {
            let (entered, release, failures) = (entered.clone(), release.clone(), failures.clone());
            move || {
                entered.set();
                if !release.wait(5.0) {
                    failures.lock().unwrap().push("release");
                }
            }
        };
        let mut pool = env.pool();
        match stage {
            "startup" => {
                env.queue
                    .set_setting("browser_tab_ids", json!(["42"]))
                    .unwrap();
                pool = pool.settle(move || {
                    blocked();
                    Ok(Vec::new())
                });
                engagement(&env.queue, "Post1");
            }
            "maintenance" => {
                pool = pool.ensure(move || {
                    blocked();
                    Ok(Vec::new())
                });
                engagement(&env.queue, "Post1");
            }
            _ => {
                digest(&env.queue, "blocked-prepare");
                let bridge = env.bridge.clone();
                pool = pool.prepare(move |_, _| {
                    blocked();
                    Ok((
                        vec![Tab::new(0).session(&bridge)],
                        ACCOUNT_USERNAME.to_owned(),
                    ))
                });
            }
        }
        let worker = env.worker(pool, returning(json!({"status": "succeeded"})));
        let observer = {
            let (queue, host, entered, release, failures) = (
                env.queue.clone(),
                env.host.clone(),
                entered.clone(),
                release.clone(),
                failures.clone(),
            );
            std::thread::spawn(move || {
                let observe = || {
                    if !entered.wait(5.0) {
                        return Err("preparation never started");
                    }
                    let before = setting(&queue, "worker").ok_or("no heartbeat")?;
                    if before["running"] != json!(true) {
                        return Err("not running");
                    }
                    // The heartbeat records the virtual clock; move it so a fresh write shows.
                    host.advance(1.0);
                    let advanced = wait_until(|| {
                        setting(&queue, "worker").is_some_and(|after| {
                            after["running"] == json!(true)
                                && after["heartbeat"].as_f64() > before["heartbeat"].as_f64()
                        })
                    });
                    if !advanced || release.is_set() {
                        return Err(
                            "Worker heartbeat did not advance while preparation was blocked",
                        );
                    }
                    Ok(())
                };
                if let Err(failure) = observe() {
                    failures.lock().unwrap().push(failure);
                }
                release.set();
            })
        };
        let result = worker.run(true, false, Arc::new(Event::default()));
        release.set();
        observer.join().unwrap();
        result.unwrap();
        assert_eq!(*failures.lock().unwrap(), Vec::<&str>::new(), "{stage}");
        assert_eq!(worker_running(&env.queue), json!(false), "{stage}");
    }
}

#[test]
fn test_uncertain_cleanup_defers_only_secondary_reads() {
    for kind in ["retrieval", "digest", "engagement"] {
        for secondary in [false, true] {
            let env = Env::new();
            let case = format!("{kind} secondary={secondary}");
            let job_id = enqueue(&env.queue, kind, "Retire");
            let failed_at = Arc::new(AtomicBool::new(false));
            let (failing, failing_navigation) = (failed_at.clone(), failed_at.clone());
            let mut tab = Tab::new(0)
                .hook(move |source, _| {
                    if source == scripts::CURRENT_ACCOUNT_USERNAME {
                        failing.store(true, Ordering::SeqCst);
                        return Some(Err(BrowserError::page_unavailable(
                            "The read operation did not finish",
                        )));
                    }
                    (source == scripts::CANCEL_REQUEST && failing.load(Ordering::SeqCst)).then(
                        || {
                            Err(BrowserError::session(
                                "Instagram browser request cancellation could not be confirmed",
                            ))
                        },
                    )
                })
                .on_navigate(move |_, _, _| {
                    failing_navigation.store(true, Ordering::SeqCst);
                    Some(Err(BrowserError::page_unavailable(
                        "The read operation did not finish",
                    )))
                });
            if secondary {
                tab = tab.secondary();
            }
            let mut session = tab.session(&env.bridge);
            let raised = execute_job(&job(&env.queue, &job_id), &mut session, None).unwrap_err();
            let deferred = secondary && kind != "engagement";
            assert!(raised.is_session(), "{case}: {raised:?}");
            assert_eq!(raised.is_cleanup_pending(), deferred, "{case}: {raised:?}");
            // Nothing retired the tab: retirement is the only osascript a tab here runs.
            assert_eq!(env.host.calls(), Vec::new(), "{case}");
        }
    }
}

#[test]
fn test_unconfirmed_secondary_retirement_fails_the_read_without_pausing() {
    let env = Env::new();
    let job_id = retrieval(&env.queue, "UnconfirmedRetirement");
    // Closing the exact tab fails, so its closure cannot be confirmed.
    env.host
        .set_responder(|_| failed("execution error: closure failed"));
    let pool = env.pool().tabs(&env.bridge, || {
        vec![
            Tab::new(0)
                .secondary()
                .hook(|source, _| {
                    (source == scripts::CANCEL_REQUEST).then(|| {
                        Err(BrowserError::session(
                            "Instagram browser request cancellation could not be confirmed",
                        ))
                    })
                })
                .on_navigate(|_, _, _| {
                    Some(Err(BrowserError::page_unavailable(
                        "The read operation did not finish",
                    )))
                }),
        ]
    });
    let worker = env.real_worker(pool);
    assert!(worker.process_next_job(true).unwrap());
    assert!(
        env.host
            .calls()
            .iter()
            .any(|call| call.runs(scripts::CLOSE_WORKER_TAB))
    );
    // A read cannot act on Instagram, so its uncertain cleanup never stops other work.
    assert!(["failed", "pending"].contains(&job(&env.queue, &job_id).state.as_str()));
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_all_fourteen_reads_drain_before_deferred_cleanup_and_no_slots_refill() {
    for retire in [false, true] {
        for rate_limited in [false, true] {
            let env = Env::new();
            let case = format!("retire={retire} rate_limited={rate_limited}");
            overrides::instagram_browser(|control| control.parallel_tabs = 15);
            let job_ids: Vec<String> = (0..14)
                .map(|index| retrieval(&env.queue, &format!("Drain{index}")))
                .collect();
            let barrier = Barrier::new(14);
            let deferred = Arc::new(Event::default());
            let healthy_settled = Arc::new(Mutex::new(Vec::new()));
            let proof = Arc::new(Mutex::new(Vec::new()));
            let extra = Arc::new(Mutex::new(Vec::new()));
            let checks = Checks::default();
            {
                // Retirement closes the exact tab, then proves it is gone.
                let (healthy, proof, check) =
                    (healthy_settled.clone(), proof.clone(), checks.clone());
                env.host.set_responder(move |call| {
                    if call.runs(scripts::CLOSE_WORKER_TAB) {
                        check.check(healthy.lock().unwrap().len() == 13, "healthy reads drained");
                        proof.lock().unwrap().push("retire");
                        return ok("closed");
                    }
                    if call.runs(scripts::WORKER_WINDOW) {
                        return failed("execution error: Pinned Instagram tab is closed. (-2700)");
                    }
                    failed("unexpected osascript")
                });
            }
            let (queue, ids, healthy, proof_by, check) = (
                env.queue.clone(),
                job_ids.clone(),
                healthy_settled.clone(),
                proof.clone(),
                checks.clone(),
            );
            let deferring = deferred.clone();
            let pool = env.pool().tabs(&env.bridge, move || {
                (0..14)
                    .map(|index| {
                        let (queue, ids, healthy, proof, check, deferring) = (
                            queue.clone(),
                            ids.clone(),
                            healthy.clone(),
                            proof_by.clone(),
                            check.clone(),
                            deferring.clone(),
                        );
                        let mut cancellations = 0;
                        Tab::new(index)
                            .secondary()
                            .hook(move |source, _| {
                                if source != scripts::CANCEL_REQUEST {
                                    return None;
                                }
                                if index != 0 {
                                    healthy.lock().unwrap().push(index);
                                    return None;
                                }
                                cancellations += 1;
                                let unconfirmed = || {
                                    Some(Err(BrowserError::session(
                                        "Instagram browser request cancellation could not be confirmed",
                                    )))
                                };
                                if cancellations == 1 {
                                    deferring.set();
                                    return unconfirmed();
                                }
                                check.check(healthy.lock().unwrap().len() == 13, "healthy drained");
                                check.check(job(&queue, &ids[0]).state == "running", "still running");
                                proof.lock().unwrap().push("cancel");
                                if retire { unconfirmed() } else { None }
                            })
                            .on_navigate(move |_, _, _| {
                                (index == 0).then(|| {
                                    Err(if rate_limited {
                                        BrowserError::rate_limited(
                                            "Instagram public media request failed with HTTP 429",
                                        )
                                    } else {
                                        BrowserError::page_unavailable(
                                            "The read operation did not finish",
                                        )
                                    })
                                })
                            })
                    })
                    .collect()
            });
            let (queue, added, check) = (env.queue.clone(), extra.clone(), checks.clone());
            let deferred = deferred.clone();
            let worker = env.worker(pool, move |job, session, on_rate_limit| {
                check.check(barrier.wait(), "fourteen reads run together");
                if index_of(session) == 0 {
                    added.lock().unwrap().push(retrieval(&queue, "NoRefill"));
                    return execute_job(job, session, on_rate_limit);
                }
                // Python's coordinator waited for every read (ALL_COMPLETED) before it
                // looked at any: healthy reads finish once the failed read has deferred
                // its cleanup, so no completion can refill a slot first.
                check.check(deferred.wait(5.0), "failed read deferred its cleanup");
                std::thread::sleep(Duration::from_millis(20));
                session.cancel_pending_request()?;
                Ok(json!({"status": "succeeded", "account_username": ACCOUNT_USERNAME}))
            });
            assert!(worker.process_next_job(true).unwrap(), "{case}");
            checks.assert_none();
            assert_eq!(
                *proof.lock().unwrap(),
                if retire {
                    vec!["cancel", "retire"]
                } else {
                    vec!["cancel"]
                },
                "{case}"
            );
            assert_eq!(job(&env.queue, &job_ids[0]).state, "pending", "{case}");
            assert_eq!(
                job(&env.queue, &job_ids[0]).attempts,
                if rate_limited { 0 } else { 1 },
                "{case}"
            );
            assert!(
                job_ids[1..]
                    .iter()
                    .all(|id| job(&env.queue, id).state == "succeeded"),
                "{case}"
            );
            let extra = extra.lock().unwrap()[0].clone();
            assert_eq!(job(&env.queue, &extra).state, "pending", "{case}");
            assert_eq!(job(&env.queue, &extra).attempts, 0, "{case}");
            let recorded = diagnostics(&env.queue);
            let first = Some(job_ids[0].clone());
            assert!(
                recorded.contains(&("pending".to_owned(), first.clone())),
                "{case}"
            );
            assert_eq!(
                env.queue.is_rate_limited(None, true).unwrap(),
                rate_limited,
                "{case}"
            );
            assert_eq!(
                recorded
                    .iter()
                    .filter(|entry| **entry == ("rate_limited".to_owned(), first.clone()))
                    .count(),
                usize::from(rate_limited),
                "{case}"
            );
            assert!(!is_paused(&env.queue), "{case}");
        }
    }
}

#[test]
fn test_confirmed_auth_failure_survives_deferred_secondary_cleanup() {
    for auth_source in ["readiness", "digest_payload"] {
        let env = Env::new();
        let job_id = digest(&env.queue, "auth-with-contention");
        let cancellations = Arc::new(Mutex::new(Vec::new()));
        let recorded = cancellations.clone();
        let pool = env.pool().tabs(&env.bridge, move || {
            let recorded = recorded.clone();
            let mut query_polled = false;
            vec![Tab::new(0).secondary().hook(move |source, page| {
                if source == scripts::PAGE_RESPONSE && auth_source == "readiness" {
                    return Some(Ok(
                        json!({"path": "/challenge/", "rate_limited": false}).to_string()
                    ));
                }
                if source == scripts::REQUEST_STATE && !page.request.is_null() {
                    // The page holds a failed auth result whose request never settles.
                    query_polled = true;
                    return Some(Ok(json!({
                        "result": {"state": "failed", "reason": "auth_required"},
                        "settled": false,
                    })
                    .to_string()));
                }
                if source == scripts::CANCEL_REQUEST {
                    let mut recorded = recorded.lock().unwrap();
                    let first_failure = !recorded.contains(&false)
                        && match auth_source {
                            "readiness" => recorded.is_empty(),
                            _ => query_polled,
                        };
                    recorded.push(!first_failure);
                    if first_failure {
                        return Some(Err(BrowserError::session(
                            "Instagram browser request cancellation could not be confirmed",
                        )));
                    }
                }
                None
            })]
        });
        let worker = env.real_worker(pool);
        assert!(worker.process_next_job(true).unwrap(), "{auth_source}");
        let expected = if auth_source == "readiness" {
            "human account recovery"
        } else {
            "human reauthorization"
        };
        assert!(paused_text(&env.queue).contains(expected), "{auth_source}");
        assert_eq!(job(&env.queue, &job_id).state, "failed", "{auth_source}");
        assert!(
            job(&env.queue, &job_id).error.unwrap().contains(expected),
            "{auth_source}"
        );
        assert!(
            diagnostics(&env.queue).contains(&("failed".to_owned(), Some(job_id.clone()))),
            "{auth_source}"
        );
        // One unconfirmed cleanup, settled later by the batch without retiring the tab.
        let cancellations = cancellations.lock().unwrap().clone();
        assert_eq!(cancellations.iter().filter(|settled| !**settled).count(), 1);
        assert_eq!(cancellations.last(), Some(&true), "{auth_source}");
        if auth_source == "readiness" {
            assert_eq!(cancellations.len(), 2);
        }
        assert_eq!(env.host.calls(), Vec::new(), "{auth_source}");
    }
}

#[test]
fn test_interruption_settles_all_unobserved_secondary_cleanup_before_releasing_lock() {
    // The "wait" case interrupted the coordinator's own wait: in Rust only a stop
    // request does that, and it is process-wide, so it is not ported.
    for interrupt_at in ["readiness", "settlement"] {
        let env = Env::new();
        let job_ids: Vec<String> = (0..2)
            .map(|index| retrieval(&env.queue, &format!("InterruptDrain{index}")))
            .collect();
        let cancel_counts = Arc::new(Mutex::new([0usize, 0]));
        let settled = Arc::new(Mutex::new(Vec::new()));
        let checks = Checks::default();
        let (counts, settled_by, check, lock_path) = (
            cancel_counts.clone(),
            settled.clone(),
            checks.clone(),
            env.lock_path(),
        );
        let pool = env.pool().tabs(&env.bridge, move || {
            (0..2)
                .map(|index| {
                    let (counts, settled, check, lock_path) = (
                        counts.clone(),
                        settled_by.clone(),
                        check.clone(),
                        lock_path.clone(),
                    );
                    Tab::new(index).secondary().hook(move |source, _| {
                        if source == scripts::PAGE_RESPONSE {
                            if interrupt_at == "readiness" && index == 0 {
                                return Some(Err(BrowserError::Interrupted));
                            }
                            if index == 1 {
                                // Let the first tab's deferred cleanup be recorded first, as
                                // Python's run did, so the pause precedes this tab's retry.
                                wait_until(|| counts.lock().unwrap()[0] >= 1);
                                std::thread::sleep(Duration::from_millis(50));
                            }
                            return Some(Err(BrowserError::page_unavailable(
                                "The read operation did not finish",
                            )));
                        }
                        if source != scripts::CANCEL_REQUEST {
                            return None;
                        }
                        let count = {
                            let mut counts = counts.lock().unwrap();
                            counts[index] += 1;
                            counts[index]
                        };
                        if count == 1 {
                            return Some(Err(BrowserError::session(
                                "Instagram browser request cancellation could not be confirmed",
                            )));
                        }
                        check.check(lock_is_held(&lock_path), "cleanup holds the browser lock");
                        if interrupt_at == "settlement" && index == 0 && count == 2 {
                            return Some(Err(BrowserError::Interrupted));
                        }
                        settled.lock().unwrap().push(index);
                        None
                    })
                })
                .collect()
        });
        let worker = env.real_worker(pool);
        let result = worker.process_next_job(true);
        assert!(
            matches!(result, Err(BrowserError::Interrupted)),
            "{interrupt_at}: {result:?}"
        );
        checks.assert_none();
        let mut settled = settled.lock().unwrap().clone();
        settled.sort();
        assert_eq!(settled, vec![0, 1], "{interrupt_at}");
        assert!(
            paused_text(&env.queue).contains("inspect browser state"),
            "{interrupt_at}"
        );
        assert!(
            job_ids
                .iter()
                .all(|id| job(&env.queue, id).state == "failed"),
            "{interrupt_at}"
        );
        assert!(!lock_is_held(&env.lock_path()), "{interrupt_at}");
    }
}

#[test]
fn test_closed_secondary_stops_refills_and_drains_before_pool_repair() {
    let env = Env::new();
    let first = retrieval(&env.queue, "ClosedTab");
    let second = retrieval(&env.queue, "HealthyTab");
    let healthy_settled = Arc::new(Event::default());
    let later = Arc::new(Mutex::new(Vec::new()));
    let checks = Checks::default();
    let healthy = healthy_settled.clone();
    let pool = env.pool().tabs(&env.bridge, move || {
        (0..2)
            .map(|index| {
                let healthy = healthy.clone();
                Tab::new(index).hook(move |source, _| {
                    if source == scripts::CANCEL_REQUEST && index == 1 {
                        healthy.set();
                    }
                    None
                })
            })
            .collect()
    });
    let (queue, first_id, second_id, added, check) = (
        env.queue.clone(),
        first.clone(),
        second.clone(),
        later.clone(),
        checks.clone(),
    );
    let worker = env.worker(
        pool,
        settling(move |job, _| {
            if job.id == first_id {
                added.lock().unwrap().push(retrieval(&queue, "KeepPending"));
                return Err(BrowserError::tab_unavailable(
                    "The pinned Instagram tab was closed",
                ));
            }
            check.check(
                job.id == second_id,
                "A closed slot must not claim more queued reads",
            );
            check.check(
                wait_until(|| setting(&queue, "retrieval_pool_account") == Some(Value::Null)),
                "pool invalidated",
            );
            check.check(
                job_state(&queue, &first_id) == "running",
                "first still running",
            );
            Ok(json!({"status": "succeeded"}))
        }),
    );
    assert!(worker.process_next_job(true).unwrap());
    checks.assert_none();
    assert!(healthy_settled.is_set());
    assert_eq!(job(&env.queue, &first).state, "pending");
    assert_eq!(job(&env.queue, &second).state, "succeeded");
    let later = later.lock().unwrap()[0].clone();
    assert_eq!(job(&env.queue, &later).state, "pending");
    assert!(!is_paused(&env.queue));
}

#[test]
fn test_digest_transient_pathname_read_recovers_without_spending_another_job_attempt() {
    for failed_read in ["initial_path", "login_recheck"] {
        let env = Env::new();
        let job_id = digest(&env.queue, "path-read-retry");
        let reads = Arc::new(AtomicUsize::new(0));
        let counted = reads.clone();
        let tab = Tab::new(0).hook(move |source, _| {
            if source != scripts::PAGE_RESPONSE {
                return None;
            }
            let attempt = counted.fetch_add(1, Ordering::SeqCst) + 1;
            if failed_read == "login_recheck" && attempt == 1 {
                return Some(Ok(
                    json!({"path": "/accounts/login/", "rate_limited": false}).to_string(),
                ));
            }
            if attempt == if failed_read == "initial_path" { 1 } else { 2 } {
                return Some(Err(BrowserError::transient(
                    "Transient pathname bridge failure",
                )));
            }
            Some(Ok(json!({"path": "/", "rate_limited": false}).to_string()))
        });
        let bridge = env.bridge.clone();
        let tab = Mutex::new(Some(tab));
        let pool = env.pool().prepare(move |_, _| {
            let tab = tab.lock().unwrap().take().expect("prepared once");
            Ok((vec![tab.session(&bridge)], ACCOUNT_USERNAME.to_owned()))
        });
        let executions = Arc::new(Mutex::new(Vec::new()));
        let executed = executions.clone();
        let worker = env.worker(
            pool,
            settling(move |job, _| {
                executed.lock().unwrap().push(job.id.clone());
                Ok(json!({"status": "succeeded"}))
            }),
        );
        assert!(worker.process_next_job(true).unwrap(), "{failed_read}");
        assert_eq!(job(&env.queue, &job_id).state, "succeeded", "{failed_read}");
        assert_eq!(job(&env.queue, &job_id).attempts, 1, "{failed_read}");
        assert_eq!(
            *executions.lock().unwrap(),
            vec![job_id.clone()],
            "{failed_read}"
        );
        assert_eq!(
            reads.load(Ordering::SeqCst),
            if failed_read == "initial_path" { 2 } else { 3 },
            "{failed_read}"
        );
        assert!(!is_paused(&env.queue), "{failed_read}");
    }
}

#[test]
fn test_profiles_are_queued_on_start_and_after_each_retrieval_not_on_a_timer() {
    // Without a database every profile collection fails and records its status; each
    // write shows one collection.
    let env = Env::new();
    let worker = env.worker(env.pool(), returning(Value::Null));
    let checked_at = || {
        setting(&env.queue, "profile_queue_status")
            .and_then(|status| status.get("checked_at").and_then(Value::as_f64))
    };
    let stopping = Arc::new(Event::default());
    let pollers = worker.source_pollers(stopping.clone());
    // Startup catches up once.
    assert!(wait_until(|| checked_at().is_some()));
    let started = checked_at().unwrap();
    env.host.advance(1.0);
    std::thread::sleep(Duration::from_millis(200));
    let unchanged = checked_at() == Some(started);
    env.queue.retrieval_finished.set();
    let rerun = wait_until(|| checked_at().is_some_and(|at| at > started));
    stopping.set();
    for poller in pollers {
        poller.join().unwrap();
    }
    assert!(unchanged, "Nothing reruns without a signal");
    assert!(rerun);
}

#[test]
fn test_a_rerun_digest_uses_the_renamed_school_accounts_current_name() {
    // Python ran the real school lookup against a fake table; the lookup is the
    // worker's `school_account_for` seam, here a fake table of recipient to slug.
    let env = Env::new();
    let online = Arc::new(AtomicBool::new(true));
    let reachable = online.clone();
    let mut worker = env.worker(env.pool(), returning(Value::Null));
    worker.seams.school_account_for = Arc::new(move |recipient_id: &str| {
        if !reachable.load(Ordering::SeqCst) || recipient_id != "76214170483" {
            return None;
        }
        school_account_username("uwaterloo").ok()
    });
    let mut payload = serde_json::Map::new();
    payload.insert("cache_ent_id".to_owned(), json!("1"));
    let job = BrowserJob {
        id: "j".to_owned(),
        kind: "digest".to_owned(),
        school: String::new(),
        recipient_id: "76214170483".to_owned(),
        account_username: "wat2do.ca".to_owned(),
        payload,
        state: "running".to_owned(),
        created_at: 0.0,
        started_at: Some(0.0),
        result: None,
        error: None,
        attempts: 1,
    };
    assert_eq!(
        worker.with_current_account(job.clone()),
        BrowserJob {
            account_username: "wat2do.uwaterloo".to_owned(),
            ..job.clone()
        }
    );
    // Other kinds, unknown recipients and an unreachable database keep the queued name.
    for kept in [
        BrowserJob {
            kind: "engagement".to_owned(),
            ..job.clone()
        },
        BrowserJob {
            recipient_id: "1".to_owned(),
            ..job.clone()
        },
    ] {
        assert_eq!(worker.with_current_account(kept.clone()), kept);
    }
    online.store(false, Ordering::SeqCst);
    assert_eq!(worker.with_current_account(job.clone()), job);
}

#[test]
fn test_login_recovery_is_spaced_capped_and_unpauses_on_success() {
    let env = Env::new();
    env.queue
        .set_setting("paused", json!(LOGGED_OUT_PAUSE))
        .unwrap();
    let results = Mutex::new(vec![
        Err(BrowserError::page_unavailable("slow")),
        Ok("wat2do.ottawa".to_owned()),
    ]);
    let pool = env
        .pool()
        .recover_login(move || results.lock().unwrap().remove(0));
    let worker = env.real_worker(pool);
    let now = Mutex::new(1000.0);
    let clock = || *now.lock().unwrap();
    // Transient: stays paused.
    assert!(!worker.recover_login(&clock).unwrap());
    assert_eq!(paused(&env.queue), json!(LOGGED_OUT_PAUSE));
    *now.lock().unwrap() += control().login_recovery_retry_seconds - 1.0;
    // Too soon to try again.
    assert!(!worker.recover_login(&clock).unwrap());
    // A Brave hiccup retries after the short delay, not the full spacing.
    *now.lock().unwrap() += 1.0;
    assert!(worker.recover_login(&clock).unwrap());
    assert_eq!(paused(&env.queue), json!(false));
    // The Brave hiccup does not count toward the daily cap; the real login does.
    let attempts = setting(&env.queue, "login_recovery_attempts").unwrap();
    assert_eq!(attempts.as_array().unwrap().len(), 1);
    // A real login spaces the next attempt by the full interval.
    assert_eq!(
        number(setting(&env.queue, "login_recovery_next_at")),
        clock() + control().login_recovery_interval_seconds
    );

    env.queue
        .set_setting("paused", json!("Inspect before retrying"))
        .unwrap();
    // Only logouts recover.
    assert!(!worker.recover_login(&clock).unwrap());
}

#[test]
fn test_login_recovery_gives_way_to_a_person_at_a_password_prompt() {
    let env = Env::new();
    env.queue
        .set_setting(
            "paused",
            json!("Instagram browser requires human account recovery"),
        )
        .unwrap();
    let pool = env.pool().recover_login(|| {
        Err(BrowserError::session(
            "Instagram needs a person: it asks for a password",
        ))
    });
    let worker = env.real_worker(pool);
    assert!(!worker.recover_login(&|| 1000.0).unwrap());
    assert_eq!(
        paused(&env.queue),
        json!("Instagram needs a person: it asks for a password")
    );
    // The new pause is not a logout pause, so no further attempts are made.
    assert!(!worker.recover_login(&|| 99_999.0).unwrap());
    let attempts = setting(&env.queue, "login_recovery_attempts").unwrap();
    assert_eq!(attempts.as_array().unwrap().len(), 1);
}

#[test]
fn test_login_recovery_stops_after_the_daily_limit() {
    let env = Env::new();
    let limit = control().login_recovery_daily_limit;
    env.queue
        .set_setting("paused", json!(LOGGED_OUT_PAUSE))
        .unwrap();
    // All within the last day; spacing alone would allow another.
    let attempts: Vec<f64> = (0..limit)
        .map(|at| 100_000.0 - 80_000.0 + at as f64)
        .collect();
    env.queue
        .set_setting("login_recovery_attempts", json!(attempts))
        .unwrap();
    let checks = Checks::default();
    let check = checks.clone();
    let pool = env
        .pool()
        .recover_login(move || Err(check.fail("over the daily limit")));
    let worker = env.real_worker(pool);
    assert!(!worker.recover_login(&|| 100_000.0).unwrap());
    checks.assert_none();
}

/// The pause a like or repost leaves when Brave stalls past its cancellation deadline.
const UNCONFIRMED_PAUSE: &str = "Instagram browser request cancellation could not be confirmed: \
     Brave browser automation timed out";

#[test]
fn test_an_unconfirmed_cancellation_pause_lifts_once_every_tab_settles() {
    let env = Env::new();
    env.queue
        .set_setting("paused", json!(UNCONFIRMED_PAUSE))
        .unwrap();
    let settles = Arc::new(AtomicUsize::new(0));
    let checks = Checks::default();
    let (counted, check, lock_path) = (settles.clone(), checks.clone(), env.lock_path());
    let results = Mutex::new(vec![
        Err(BrowserError::session(UNCONFIRMED_PAUSE)),
        Err(BrowserError::Timeout(
            "Brave browser automation timed out".to_owned(),
        )),
        Ok(Vec::new()),
    ]);
    let pool = env.pool().settle(move || {
        check.check(lock_is_held(&lock_path), "settling holds the browser lock");
        counted.fetch_add(1, Ordering::SeqCst);
        results.lock().unwrap().remove(0)
    });
    let worker = env.real_worker(pool);
    let now = Mutex::new(1000.0);
    let clock = || *now.lock().unwrap();
    let retry = control().cancellation_confirm_retry_seconds;
    // Brave still cannot confirm it: the pause stays and the next check waits.
    assert!(!worker.confirm_cancellation(&clock).unwrap());
    assert_eq!(paused(&env.queue), json!(UNCONFIRMED_PAUSE));
    assert_eq!(
        number(setting(&env.queue, "cancellation_confirm_next_at")),
        1000.0 + retry
    );
    *now.lock().unwrap() += retry - 1.0;
    assert!(!worker.confirm_cancellation(&clock).unwrap());
    assert_eq!(settles.load(Ordering::SeqCst), 1);
    // A timeout keeps the pause too.
    *now.lock().unwrap() += 1.0;
    assert!(!worker.confirm_cancellation(&clock).unwrap());
    assert_eq!(paused(&env.queue), json!(UNCONFIRMED_PAUSE));
    // Every tab settles: browser work resumes.
    *now.lock().unwrap() += retry;
    assert!(worker.confirm_cancellation(&clock).unwrap());
    assert_eq!(paused(&env.queue), json!(false));
    assert_eq!(settles.load(Ordering::SeqCst), 3);
    checks.assert_none();
}

#[test]
fn test_a_closed_worker_tab_confirms_its_cancellation() {
    let env = Env::new();
    env.queue
        .set_setting("paused", json!(UNCONFIRMED_PAUSE))
        .unwrap();
    let pool = env.pool().settle(|| {
        Err(BrowserError::tab_unavailable(
            "No worker Instagram window is open",
        ))
    });
    let worker = env.real_worker(pool);
    assert!(worker.confirm_cancellation(&|| 1000.0).unwrap());
    assert_eq!(paused(&env.queue), json!(false));
}

#[test]
fn test_cancellation_confirmation_leaves_every_other_pause_alone() {
    let env = Env::new();
    let checks = Checks::default();
    let check = checks.clone();
    let pool = env
        .pool()
        .settle(move || Err(check.fail("only an unconfirmed cancellation is confirmed")));
    let worker = env.real_worker(pool);
    for pause in [
        json!(false),
        json!(true),
        json!(LOGGED_OUT_PAUSE),
        json!(
            "Instagram engagement completion is uncertain; inspect browser state before resuming"
        ),
        json!("Worker interrupted during engagement; inspect browser state before resuming"),
    ] {
        env.queue.set_setting("paused", pause.clone()).unwrap();
        assert!(!worker.confirm_cancellation(&|| 1000.0).unwrap());
        assert_eq!(paused(&env.queue), pause);
    }
    checks.assert_none();
}

#[test]
fn test_a_pause_written_while_tabs_settle_is_kept() {
    let env = Env::new();
    env.queue
        .set_setting("paused", json!(UNCONFIRMED_PAUSE))
        .unwrap();
    // A person pauses the worker while the tabs settle.
    let queue = env.queue.clone();
    let pool = env.pool().settle(move || {
        queue.set_setting("paused", json!(true))?;
        Ok(Vec::new())
    });
    let worker = env.real_worker(pool);
    assert!(!worker.confirm_cancellation(&|| 1000.0).unwrap());
    assert_eq!(paused(&env.queue), json!(true));
}

#[test]
fn test_the_worker_resumes_by_itself_after_an_unconfirmed_cancellation() {
    let env = Env::new();
    // A like times out while the Mac is busy and pauses every school's work.
    let engagement_id = engagement(&env.queue, "TimedOut");
    let worker = env.worker(env.pool(), |_, _, _| {
        Err(BrowserError::session(UNCONFIRMED_PAUSE))
    });
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(paused(&env.queue), json!(UNCONFIRMED_PAUSE));
    let digest_id = digest(&env.queue, "cache-after-the-stall");
    // Brave answers again: the next pass confirms the tabs settled and takes the digest.
    let worker = env.worker(env.pool(), returning(json!({"status": "succeeded"})));
    worker.run(true, false, Arc::new(Event::default())).unwrap();
    assert!(!is_paused(&env.queue));
    assert_eq!(job(&env.queue, &digest_id).state, "succeeded");
    // The engagement itself is never replayed.
    assert_eq!(job(&env.queue, &engagement_id).state, "failed");
    assert_eq!(job(&env.queue, &engagement_id).attempts, 1);
}

#[test]
fn test_a_missing_account_is_logged_in_once_a_day_and_capped() {
    let env = Env::new();
    let added = Arc::new(Mutex::new(Vec::new()));
    let now = Arc::new(Mutex::new(100_000.0));
    let (record, queue, entered_at) = (added.clone(), env.queue.clone(), now.clone());
    let pool = env.pool().add_account(move |username| {
        record.lock().unwrap().push(username.to_owned());
        // The pool records the login as its password goes out.
        assert!(
            queue
                .reserve_account_login(username, *entered_at.lock().unwrap())
                .unwrap()
        );
        Ok(())
    });
    let worker = env.real_worker(pool);
    let clock = || *now.lock().unwrap();

    assert!(
        worker
            .attempt_account_login("wat2do.ucalgary", &clock)
            .unwrap()
    );
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &clock)
            .unwrap()
    );
    *now.lock().unwrap() += 86_400.0;
    assert!(
        worker
            .attempt_account_login("wat2do.ucalgary", &clock)
            .unwrap()
    );
    assert_eq!(
        *added.lock().unwrap(),
        vec!["wat2do.ucalgary", "wat2do.ucalgary"]
    );

    let spent = vec![clock(); control().account_login_daily_limit];
    env.queue
        .set_setting("account_login_attempts", json!(spent))
        .unwrap();
    assert!(!worker.attempt_account_login("wat2do.sfu", &clock).unwrap());
}

#[test]
fn test_a_failed_account_login_leaves_the_job_to_fail() {
    let env = Env::new();
    let pool = env.pool().add_account(|_| {
        Err(BrowserError::session(
            "Instagram needs a person: it refused the password",
        ))
    });
    let worker = env.real_worker(pool);
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &|| 100_000.0)
            .unwrap()
    );
    assert_eq!(setting(&env.queue, "paused"), None);
}

#[test]
fn test_blocked_collector_cannot_delay_a_digest_and_stops_on_shutdown() {
    let env = Env::new();
    overrides::instagram_browser(|control| control.worker_poll_interval_seconds = 0.01);
    let entered = Arc::new(Event::default());
    let release = Arc::new(Event::default());
    let finished = Arc::new(Event::default());
    let digest_id = digest(&env.queue, "cache-independent");
    let calls = Arc::new(Mutex::new(Vec::new()));
    let checks = Checks::default();
    let terminate = Arc::new(Event::default());
    let (entering, released, finishing, check) = (
        entered.clone(),
        release.clone(),
        finished.clone(),
        checks.clone(),
    );
    let mut worker = {
        let (entered, release, finished, recorded, stop, check) = (
            entered.clone(),
            release.clone(),
            finished.clone(),
            calls.clone(),
            terminate.clone(),
            checks.clone(),
        );
        env.worker(env.pool(), move |job, _, _| {
            check.check(entered.wait(5.0), "collector started first");
            check.check(!finished.is_set(), "collector still blocked");
            recorded.lock().unwrap().push(job.id.clone());
            // Python's next process_next_job released the collector and interrupted.
            release.set();
            stop.set();
            Ok(json!({"status": "succeeded"}))
        })
    };
    worker.seams.collect_carousels = Arc::new(move |_: &Worker| {
        entering.set();
        check.check(released.wait(5.0), "collector released");
        finishing.set();
        Ok(json!({"submitted": 0}))
    });
    let result = worker.run(false, true, terminate);
    release.set();
    result.unwrap();
    checks.assert_none();
    assert_eq!(*calls.lock().unwrap(), vec![digest_id.clone()]);
    assert_eq!(job(&env.queue, &digest_id).state, "succeeded");
    assert!(finished.is_set());
    assert_eq!(worker_running(&env.queue), json!(false));
}

#[test]
fn test_source_failure_does_not_prevent_collecting_published_engagement() {
    // Without a database the profile and diagnostics collections both fail; Python's
    // "ValueError" is recorded here as the error kind of that failure.
    for (failed_source, status_key) in [
        ("profiles", "profile_queue_status"),
        ("diagnostics", "diagnostics_status"),
    ] {
        let env = Env::new();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let checks = Checks::default();
        let mut worker = env.worker(env.pool(), returning(Value::Null));
        let (queue, recorded, check) = (env.queue.clone(), calls.clone(), checks.clone());
        worker.seams.collect_carousels = Arc::new(move |current: &Worker| {
            check.check(Arc::ptr_eq(&current.queue, &queue), "the worker's queue");
            check.check(
                wait_until(|| setting(&queue, status_key).is_some()),
                "the other source failed first",
            );
            recorded.lock().unwrap().push("carousel");
            Ok(json!({"submitted": 1}))
        });
        let stopping = Arc::new(Event::default());
        let (_, logs) = capture_logs(|| {
            let pollers = worker.source_pollers(stopping.clone());
            assert!(wait_until(|| setting(&env.queue, "source_status").is_some()));
            stopping.set();
            for poller in pollers {
                poller.join().unwrap();
            }
        });
        checks.assert_none();
        assert_eq!(*calls.lock().unwrap(), vec!["carousel"], "{failed_source}");
        assert_eq!(
            setting(&env.queue, "source_status").unwrap()["result"],
            json!({"submitted": 1}),
            "{failed_source}"
        );
        assert_eq!(
            setting(&env.queue, status_key).unwrap()["error"],
            json!("RuntimeError"),
            "{failed_source}"
        );
        assert!(!logs.contains("database connection"), "{logs}");
    }
}

#[test]
fn test_blocked_source_does_not_delay_other_source_pollers() {
    // Only the carousel collection has a seam, so it is the blocked source; the profile
    // and diagnostics pollers (which fail without a database) must still progress.
    let env = Env::new();
    let entered = Arc::new(Event::default());
    let release = Arc::new(Event::default());
    let checks = Checks::default();
    let mut worker = env.worker(env.pool(), returning(Value::Null));
    let (entering, released, check) = (entered.clone(), release.clone(), checks.clone());
    worker.seams.collect_carousels = Arc::new(move |_: &Worker| {
        entering.set();
        check.check(released.wait(5.0), "released");
        Ok(json!({}))
    });
    let stopping = Arc::new(Event::default());
    let pollers = worker.source_pollers(stopping.clone());
    let progressed = entered.wait(5.0)
        && wait_until(|| {
            setting(&env.queue, "profile_queue_status").is_some()
                && setting(&env.queue, "diagnostics_status").is_some()
        })
        && !release.is_set();
    stopping.set();
    release.set();
    for poller in pollers {
        poller.join().unwrap();
    }
    assert!(progressed);
    checks.assert_none();
}

#[test]
fn test_login_recovery_after_a_submitted_password_pauses_without_a_refund() {
    let env = Env::new();
    env.queue
        .set_setting("paused", json!(LOGGED_OUT_PAUSE))
        .unwrap();
    let message = "Instagram did not accept the saved login; inspect before retrying";
    let pool = env
        .pool()
        .recover_login(move || Err(BrowserError::of(SessionKind::LoginSubmitted, message)));
    let worker = env.real_worker(pool);
    assert!(!worker.recover_login(&|| 1000.0).unwrap());
    assert_eq!(paused(&env.queue), json!(message));
    let attempts = setting(&env.queue, "login_recovery_attempts").unwrap();
    assert_eq!(attempts, json!([1000.0]));
    assert_eq!(
        number(setting(&env.queue, "login_recovery_next_at")),
        1000.0 + control().login_recovery_interval_seconds
    );
    // A person's pause, not a logout: no further attempt.
    assert!(!worker.recover_login(&|| 99_999.0).unwrap());
    let attempts = setting(&env.queue, "login_recovery_attempts").unwrap();
    assert_eq!(attempts.as_array().unwrap().len(), 1);
}

#[test]
fn test_account_login_after_a_submitted_password_holds_only_that_account() {
    let env = Env::new();
    let message = "Instagram asked for a code after the password; inspect before retrying";
    let tried = Arc::new(Mutex::new(Vec::new()));
    let record = tried.clone();
    let pool = env.pool().add_account(move |username| {
        record.lock().unwrap().push(username.to_owned());
        if username == "wat2do.ucalgary" {
            Err(BrowserError::of(SessionKind::LoginSubmitted, message))
        } else {
            Ok(())
        }
    });
    let worker = env.real_worker(pool);
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &|| 100_000.0)
            .unwrap()
    );
    // Every other school's work runs on.
    assert_eq!(setting(&env.queue, "paused"), None);
    assert_eq!(
        env.queue.account_login_paused("wat2do.ucalgary").unwrap(),
        Some(message.to_owned())
    );
    assert_eq!(
        env.queue.status().unwrap()["accounts_paused"],
        json!({"wat2do.ucalgary": message})
    );
    assert!(
        worker
            .attempt_account_login("wat2do.sfu", &|| 100_000.0)
            .unwrap()
    );
    // Never retried automatically, even a day later, until a person resumes it.
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &|| 300_000.0)
            .unwrap()
    );
    assert_eq!(
        *tried.lock().unwrap(),
        vec!["wat2do.ucalgary", "wat2do.sfu"]
    );
    env.queue.resume_account_login("wat2do.ucalgary").unwrap();
    assert_eq!(
        env.queue.account_login_paused("wat2do.ucalgary").unwrap(),
        None
    );
    assert_eq!(env.queue.status().unwrap()["accounts_paused"], json!({}));
    assert!(
        env.queue
            .account_login_allowed("wat2do.ucalgary", 300_000.0)
            .unwrap()
    );
}

#[test]
fn test_account_login_session_failure_before_a_password_does_not_pause() {
    let env = Env::new();
    let tried = Arc::new(AtomicUsize::new(0));
    let counted = tried.clone();
    let pool = env.pool().add_account(move |_| {
        counted.fetch_add(1, Ordering::SeqCst);
        Err(BrowserError::session(
            "The account switcher did not offer to log in an existing account",
        ))
    });
    let worker = env.real_worker(pool);
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &|| 100_000.0)
            .unwrap()
    );
    assert_eq!(setting(&env.queue, "paused"), None);
    // No password went out, so nothing is spent: the next job tries the account again.
    assert!(
        !worker
            .attempt_account_login("wat2do.ucalgary", &|| 101_000.0)
            .unwrap()
    );
    assert_eq!(tried.load(Ordering::SeqCst), 2);
    assert_eq!(
        setting(&env.queue, "account_login_at:wat2do.ucalgary"),
        None
    );
}

#[test]
fn test_account_login_reservation_is_daily_per_account_and_capped() {
    let env = Env::new();
    let limit = control().account_login_daily_limit;
    let now = 100_000.0;
    assert!(env.queue.reserve_account_login("wat2do.a0", now).unwrap());
    // A second same-day login of one account is refused.
    assert!(
        !env.queue
            .reserve_account_login("wat2do.a0", now + 60.0)
            .unwrap()
    );
    for index in 1..limit {
        assert!(
            env.queue
                .reserve_account_login(&format!("wat2do.a{index}"), now)
                .unwrap()
        );
    }
    // Beyond the daily total, even a fresh account is refused.
    assert!(
        !env.queue
            .reserve_account_login("wat2do.fresh", now)
            .unwrap()
    );
    // A day later both the account and the total have room again.
    assert!(
        env.queue
            .reserve_account_login("wat2do.a0", now + 86_400.0)
            .unwrap()
    );
}

// ---------------------------------------------------------------------------------
// Following reads
// ---------------------------------------------------------------------------------

/// A Following page read as `account`.
fn following_page(account: &str) -> Value {
    json!({"account_username": account, "username": "club.one", "user_id": "101", "users": [], "next_max_id": null})
}

#[test]
fn test_a_following_read_runs_alone_on_one_tab_as_the_shown_account() {
    let env = Env::new();
    let first = following(&env.queue, "club.one");
    let second = following(&env.queue, "club.two");
    let prepared = Arc::new(Mutex::new(Vec::new()));
    let (seen, bridge) = (prepared.clone(), env.bridge.clone());
    let pool = env.pool().prepare(move |job, count| {
        seen.lock().unwrap().push((job.kind.clone(), count));
        Ok((
            (0..count)
                .map(|index| Tab::new(index).session(&bridge))
                .collect(),
            ACCOUNT_USERNAME.to_owned(),
        ))
    });
    let worker = env.worker(pool, settling(|_, _| Ok(following_page(ACCOUNT_USERNAME))));
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(*prepared.lock().unwrap(), [("following".to_owned(), 1)]);
    assert_eq!(job(&env.queue, &first).state, "succeeded");
    assert_eq!(
        job(&env.queue, &first).result,
        Some(following_page(ACCOUNT_USERNAME))
    );
    assert_eq!(job(&env.queue, &second).state, "pending");
    // The next list waits its pause.
    assert!(!worker.process_next_job(true).unwrap());
}

#[test]
fn test_a_following_rate_limit_or_login_wall_holds_only_following_reads() {
    let env = Env::new();
    let read = following(&env.queue, "club.one");
    let worker = env.worker(
        env.pool(),
        settling(|_, _| {
            Err(BrowserError::rate_limited(
                "Instagram asked for a login on a Following read",
            ))
        }),
    );
    assert!(worker.process_next_job(true).unwrap());
    assert_eq!(job(&env.queue, &read).state, "pending");
    assert_eq!(job(&env.queue, &read).attempts, 0);
    assert!(number(setting(&env.queue, "following_rate_limit_until")) > env.host.time());
    assert!(!env.queue.is_rate_limited(None, true).unwrap());
    assert!(!is_paused(&env.queue));
    let notified = digest(&env.queue, "AfterFollowingLimit");
    assert_eq!(
        env.queue.claim_next(None, true).unwrap().unwrap().id,
        notified
    );
}

#[test]
fn test_a_following_read_from_another_account_is_never_kept() {
    let env = Env::new();
    let read = following(&env.queue, "club.one");
    let worker = env.worker(
        env.pool(),
        settling(|_, _| Ok(following_page("wat2do.other"))),
    );
    assert!(worker.process_next_job(true).unwrap());
    let stored = job(&env.queue, &read);
    assert_eq!(stored.state, "pending");
    assert_eq!(stored.result, None);
}
