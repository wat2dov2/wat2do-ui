//! Ported from `tests/scripts/test_instagram_browser.py`.
//!
//! Commands run through `cli::run(Cli::parse_from(..), &FakeCli)`: its `host` is a
//! `FakeHost` standing in for `launchctl`, its LaunchAgent path is in a temporary
//! directory, and the database seams (school lookup, publishing tables, ingestion
//! queue) and the worker loop are recorded fakes. The worker log tests exercise
//! `logs::RotatingLog` (and `logs::PythonFormat`) directly, under a thread-local
//! tracing subscriber built like `logs::init_worker_log`.

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex;

use chrono::{DateTime as ChronoDateTime, NaiveDateTime, Utc};
use fs2::FileExt;
use tracing_subscriber::fmt::MakeWriter;
use uuid::Uuid;

use super::*;
use crate::host::CommandOutput;
use crate::instagram_notifications::carousel_engagement::{
    PublishedBatch, PublishedItem, PublishingAccount,
};
use crate::instagram_notifications::test_support::{FakeHost, HostCall, ok, queue as open_queue};
use crate::logs::{PythonFormat, RotatingLog, Style};
use crate::schools::School;

const AUTH_HOLD: &str = "Instagram account requires reauthentication";

/// The school `retrieve` resolves, with its notification recipient.
fn ubc() -> School {
    School {
        id: 3,
        slug: "ubc".into(),
        name: "University of British Columbia".into(),
        timezone: "America/Vancouver".into(),
        semester_start: None,
        semester_end: None,
        recipient_id: Some("12342599092".into()),
    }
}

/// Only `enabled_accounts` is reachable from `inspect`.
struct Accounts(Vec<PublishingAccount>);

impl PublishingStore for Accounts {
    fn enabled_accounts(&self) -> anyhow::Result<Vec<PublishingAccount>> {
        Ok(self.0.clone())
    }

    fn published_batches(
        &self,
        _since: ChronoDateTime<Utc>,
        _until: ChronoDateTime<Utc>,
        _delivery_generation: &str,
        _after: Option<(ChronoDateTime<Utc>, Uuid)>,
    ) -> anyhow::Result<Vec<PublishedBatch>> {
        unreachable!("inspect reads no batches")
    }

    fn published_items(&self, _batch_id: Uuid) -> anyhow::Result<Vec<PublishedItem>> {
        unreachable!("inspect reads no items")
    }

    fn ensure_source(
        &self,
        _proposed: ChronoDateTime<Utc>,
    ) -> anyhow::Result<Option<ChronoDateTime<Utc>>> {
        unreachable!("inspect registers no source")
    }

    fn freeze_sources(&self, _batch_id: &str, _sources: &[Value]) -> anyhow::Result<Vec<Value>> {
        unreachable!("inspect freezes nothing")
    }

    fn acknowledge(
        &self,
        _row_id: &str,
        _delivery_generation: &str,
        _sources: &[Value],
    ) -> anyhow::Result<()> {
        unreachable!("inspect acknowledges nothing")
    }
}

struct FakeCli {
    host: Arc<FakeHost>,
    home: PathBuf,
    school: Option<School>,
    publishing: Accounts,
    queued: Mutex<Vec<(Vec<String>, String)>>,
    workers: Mutex<Vec<(bool, bool)>>,
    /// Python's tests set `sys.platform = "darwin"`; the fake is a Mac unless told otherwise.
    mac: bool,
    /// The source the fake binary was built from.
    fingerprint: String,
    /// The checkout it was built in; the runtime checkout unless a test says otherwise.
    checkout: PathBuf,
}

/// A committed source fingerprint for the fake binary.
const FAKE_FINGERPRINT: &str = "4f1c0de0b5a1e9f2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a";

impl FakeCli {
    fn new(home: &Path) -> Self {
        Self {
            host: FakeHost::new(|call| panic!("unexpected subprocess {call:?}")),
            home: home.to_path_buf(),
            mac: true,
            fingerprint: FAKE_FINGERPRINT.to_owned(),
            checkout: home.join("wat2do-runtime"),
            school: None,
            publishing: Accounts(Vec::new()),
            queued: Mutex::new(Vec::new()),
            workers: Mutex::new(Vec::new()),
        }
    }

    fn with_host(mut self, host: Arc<FakeHost>) -> Self {
        self.host = host;
        self
    }

    fn plist(&self) -> PathBuf {
        self.agent_path(LAUNCH_AGENT_LABEL)
    }
}

impl CliServices for FakeCli {
    fn host(&self) -> Arc<dyn Host> {
        self.host.clone()
    }

    fn school_by_slug(&self, _slug: &str) -> anyhow::Result<Option<School>> {
        Ok(self.school.clone())
    }

    fn publishing(&self) -> anyhow::Result<&dyn PublishingStore> {
        Ok(&self.publishing)
    }

    fn queue_posts(&self, urls: &[String], school: &str) -> anyhow::Result<usize> {
        self.queued
            .lock()
            .unwrap()
            .push((urls.to_vec(), school.to_owned()));
        Ok(1)
    }

    fn run_worker(
        &self,
        _queue: Arc<BrowserJobQueue>,
        once: bool,
        collect: bool,
    ) -> anyhow::Result<()> {
        self.workers.lock().unwrap().push((once, collect));
        Ok(())
    }

    fn is_mac(&self) -> bool {
        self.mac
    }

    fn agent_path(&self, label: &str) -> PathBuf {
        self.home
            .join("Library/LaunchAgents")
            .join(format!("{label}.plist"))
    }

    fn launchctl(&self, timeout: Duration, poll_interval: Duration) -> anyhow::Result<Launchctl> {
        Ok(Launchctl::new(self.host(), timeout, poll_interval))
    }

    fn installed_binary(&self) -> PathBuf {
        self.home.join(".local/libexec/wat2do/wat2do-browser")
    }

    fn source_fingerprint(&self) -> String {
        self.fingerprint.clone()
    }

    fn checkout(&self) -> PathBuf {
        std::fs::create_dir_all(&self.checkout).unwrap();
        self.checkout.clone()
    }

    fn runtime_checkout(&self) -> PathBuf {
        let runtime = self.home.join("wat2do-runtime");
        std::fs::create_dir_all(&runtime).unwrap();
        runtime
    }

    fn retry_state_directory(&self) -> PathBuf {
        self.home.join(".local/state/wat2do/notification-retry")
    }

    fn current_binary(&self) -> anyhow::Result<PathBuf> {
        let binary = self.home.join("build/wat2do-browser");
        if !binary.exists() {
            std::fs::create_dir_all(binary.parent().unwrap())?;
            std::fs::write(&binary, "a built worker binary")?;
        }
        Ok(binary)
    }
}

fn main_with(services: &FakeCli, state: &Path, arguments: &[&str]) -> (u8, String, String) {
    let mut argv = vec![
        "wat2do-browser".to_owned(),
        "--state-directory".to_owned(),
        state.display().to_string(),
    ];
    argv.extend(arguments.iter().map(|argument| (*argument).to_owned()));
    run(Cli::parse_from(argv), services)
}

/// `launchctl`: `print` reports an unloaded service (3), everything else succeeds
/// unless `failing` names it.
fn launchctl(failing: Option<(&'static str, i32)>) -> Arc<FakeHost> {
    FakeHost::new(move |call: &HostCall| {
        assert_eq!(call.program, "launchctl");
        let verb = call.args[0].as_str();
        let code = match failing {
            Some((name, code)) if name == verb => code,
            _ if verb == "print" => 3,
            _ => 0,
        };
        Ok(crate::host::CommandOutput {
            code,
            stdout: String::new(),
            stderr: String::new(),
        })
    })
}

/// One top-level entry of a LaunchAgent payload.
fn entry<'a>(payload: &'a Plist, key: &str) -> &'a Plist {
    let Plist::Dict(entries) = payload else {
        panic!("not a dict");
    };
    &entries[key]
}

fn verbs(host: &FakeHost) -> Vec<String> {
    host.calls()
        .iter()
        .map(|call| call.args[0].clone())
        .collect()
}

/// `logs::init_worker_log`'s subscriber, for this thread only.
fn worker_subscriber(log: RotatingLog) -> impl tracing::Subscriber + Send + Sync {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .event_format(PythonFormat(Style::LevelTarget))
        .with_writer(log)
        .finish()
}

fn emit(log: &RotatingLog, message: &str) {
    let mut writer = log.make_writer();
    writer.write_all(format!("{message}\n").as_bytes()).unwrap();
}

fn mode(path: &Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn log_files(directory: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("worker.operations.log")
        })
        .collect()
}

#[test]
fn test_worker_logs_are_bounded_files_and_do_not_stream_to_launchd() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("worker.stderr.log");
    std::fs::write(&legacy, "Existing launchd log is preserved.\n").unwrap();
    let services = FakeCli::new(directory.path());

    assert_eq!(
        main_with(&services, directory.path(), &["worker", "--once"]).0,
        0
    );
    let path = directory.path().join("worker.operations.log");
    let log = RotatingLog::new(
        path.clone(),
        control().worker_log_max_bytes,
        control().worker_log_backup_count,
    );
    tracing::subscriber::with_default(worker_subscriber(log), || {
        tracing::warn!(target: "instagram.worker.test", "Verified worker diagnostic");
    });

    assert!(
        std::fs::read_to_string(&path)
            .unwrap()
            .contains("Verified worker diagnostic")
    );
    assert_eq!(mode(&path), 0o600);
    assert_eq!(
        std::fs::read_to_string(&legacy).unwrap(),
        "Existing launchd log is preserved.\n"
    );
}

#[test]
fn test_worker_log_rotation_survives_real_lazy_source_imports() {
    let directory = tempfile::tempdir().unwrap();
    let log = RotatingLog::new(directory.path().join("worker.operations.log"), 256, 3);
    tracing::subscriber::with_default(worker_subscriber(log), || {
        tracing::info!(target: "instagram.worker.test", "Ignored informational diagnostic");
        for index in 0..50 {
            tracing::warn!(
                target: "instagram.worker.test",
                "Diagnostic {index:03}: {}",
                "x".repeat(70)
            );
        }
    });

    let files = log_files(directory.path());
    assert_eq!(files.len(), 4);
    for path in &files {
        assert!(std::fs::metadata(path).unwrap().len() <= 256);
        assert!(
            !std::fs::read_to_string(path)
                .unwrap()
                .contains("Ignored informational diagnostic")
        );
    }
}

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn test_default_application_logs_keep_timestamp_and_level_prefix() {
    let captured = Captured::default();
    let writer = captured.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .event_format(PythonFormat(Style::Timestamped))
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        tracing::info!("Application diagnostic");
    });

    let output = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    let (prefix, message) = output.trim().split_once(" INFO ").unwrap();
    NaiveDateTime::parse_from_str(prefix, "%Y-%m-%d %H:%M:%S,%3f").unwrap();
    assert_eq!(message, "Application diagnostic");
}

#[test]
fn test_worker_log_rotation_bounds_utf8_bytes_and_backup_count() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("worker.operations.log");
    let log = RotatingLog::new(path.clone(), 256, 3);
    for index in 0..50 {
        emit(&log, &format!("entry-{index:03}: {}", "é".repeat(70)));
    }
    emit(&log, &format!("oversized:{}", "é".repeat(300)));

    let files = log_files(directory.path());
    assert_eq!(files.len(), 4);
    for file in &files {
        assert!(std::fs::metadata(file).unwrap().len() <= 256);
        assert_eq!(mode(file), 0o600);
    }
    assert!(
        std::fs::read_to_string(&path)
            .unwrap()
            .contains("[truncated]")
    );
}

/// Python injected `OSError(ENOSPC | EDQUOT | EACCES)` from the handler's `_open`.
/// Rust has no open seam, so the failures here are real ones a test can cause and
/// undo: a directory where the log file belongs, and a read-only state directory
/// (EACCES). Whether the stderr warning was written is read through
/// `RotatingLog::failure_reported`, since libtest cannot capture raw stderr writes.
#[test]
fn test_worker_log_write_failure_warns_once_and_recovers_without_tracebacks() {
    for case in ["directory in the way", "permission denied"] {
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        std::fs::create_dir(&state).unwrap();
        let path = state.join("worker.operations.log");
        let fail = || match case {
            "directory in the way" => std::fs::create_dir(&path).unwrap(),
            _ => std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o500)).unwrap(),
        };
        let recover = || match case {
            "directory in the way" => std::fs::remove_dir(&path).unwrap(),
            _ => std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o700)).unwrap(),
        };
        let log = RotatingLog::new(path.clone(), 256, 3);

        fail();
        emit(&log, "private diagnostic content");
        emit(&log, "private diagnostic content");
        assert!(log.failure_reported(), "{case}");

        recover();
        emit(&log, "private diagnostic content");
        assert!(!log.failure_reported(), "{case}");
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("private diagnostic content")
        );

        // Fail again: the open file only fails once a rollover renames it, which a
        // read-only state directory refuses.
        std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o500)).unwrap();
        for _ in 0..3 {
            emit(&log, &"x".repeat(200));
        }
        assert!(log.failure_reported(), "{case}");
        std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o700)).unwrap();
        emit(&log, "private diagnostic content");
        assert!(!log.failure_reported(), "{case}");
    }
}

#[test]
fn test_interactive_commands_keep_stream_logging() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());

    assert_eq!(main_with(&services, directory.path(), &["pause"]).0, 0);

    assert!(!directory.path().join("worker.operations.log").exists());
}

/// Python replaced `sys.stderr` with a stream that always fails; Rust writes the
/// warning with `let _ = stderr().write_all(..)`. What remains testable: repeated
/// failures never panic and the warning is attempted once.
#[test]
fn test_failed_worker_log_does_not_crash_when_launchd_stderr_is_also_full() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("worker.operations.log");
    std::fs::create_dir(&path).unwrap();
    let log = RotatingLog::new(path, 256, 3);

    for _ in 0..3 {
        emit(&log, "private diagnostic content");
    }

    assert!(log.failure_reported());
}

#[test]
fn test_install_uses_stable_checkout_and_shared_spool() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = launchctl(None);
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);

    let (code, stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(result["plist"], services.plist().display().to_string());
    let binary = services.installed_binary();
    let payload = launch_agent_payload(&queue, &binary, &services.runtime_checkout());
    assert_eq!(
        std::fs::read_to_string(services.plist()).unwrap(),
        launch_agents::to_xml(&payload).unwrap()
    );
    assert_eq!(
        entry(&payload, "ProgramArguments"),
        &Plist::Array(vec![
            binary.display().to_string().into(),
            "--state-directory".into(),
            state.canonicalize().unwrap().display().to_string().into(),
            "worker".into(),
        ])
    );
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "a built worker binary"
    );
    assert_eq!(result["binary"]["replaced"], true);
    assert_eq!(
        entry(&payload, "WorkingDirectory"),
        &Plist::from(
            services
                .runtime_checkout()
                .join("backend")
                .display()
                .to_string()
        )
    );
    assert_eq!(entry(&payload, "KeepAlive"), &Plist::Bool(true));
    assert_eq!(entry(&payload, "RunAtLoad"), &Plist::Bool(true));
    assert_eq!(verbs(&host), vec!["print", "enable", "bootstrap"]);
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(false)));
    // Only PATH: no credential such as DATA_API_KEY reaches the worker's environment.
    let Plist::Dict(environment) = entry(&payload, "EnvironmentVariables") else {
        panic!("no environment");
    };
    assert_eq!(environment.keys().collect::<Vec<_>>(), ["PATH"]);
}

#[test]
fn test_install_reports_failed_bootstrap() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = launchctl(Some(("bootstrap", 7)));
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);

    let (code, _, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stderr.contains("bootstrap"), "{stderr}");
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(false)));
    assert!(!services.plist().exists());
}

#[test]
fn test_install_refuses_to_interrupt_running_browser_work() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = FakeHost::new(|_| panic!("must keep worker alive"));
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);
    queue
        .enqueue_engagement(
            "ubc",
            "123",
            "ubc.wat2do.io",
            "https://www.instagram.com/p/abc/",
            None,
            false,
        )
        .unwrap();
    queue.claim_next(None, true).unwrap().unwrap();

    let (code, _, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stderr.contains("current browser jobs"), "{stderr}");
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(false)));
    assert!(host.calls().is_empty());
}

#[test]
fn test_concurrent_installs_cannot_overwrite_pause_ownership() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = FakeHost::new(|_| panic!("must not touch launchd"));
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(state.join("worker-install.lock"))
        .unwrap();
    lock.try_lock_exclusive().unwrap();

    let (code, _, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stderr.contains("installation is still running"), "{stderr}");
    drop(lock);
    assert_eq!(
        queue.setting_or("paused", json!(false)).unwrap(),
        json!(false)
    );
}

#[test]
fn test_install_cannot_erase_a_new_runtime_safety_pause() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = launchctl(None);
    let queue = open_queue(&state, &host);
    let runtime = queue.clone();
    host.set_responder(move |call| {
        if call.args[0] == "bootstrap" {
            runtime.set_setting("paused", json!(AUTH_HOLD)).unwrap();
        }
        if call.args[0] == "print" {
            return Ok(crate::host::CommandOutput {
                code: 3,
                stdout: String::new(),
                stderr: String::new(),
            });
        }
        ok("")
    });
    let services = FakeCli::new(directory.path()).with_host(host.clone());

    assert_eq!(main_with(&services, &state, &["install"]).0, 0);

    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(AUTH_HOLD)));
}

/// Python's `install_launch_agent` raised `LaunchAgentRecoveryError`; here launchd
/// itself leaves recovery uncertain: the service is loaded, the new agent fails to
/// bootstrap, and the stale service never unloads (on the virtual clock).
#[test]
fn test_install_preserves_a_recovery_pause_when_service_restoration_is_uncertain() {
    for prior_pause in [json!(false), json!(AUTH_HOLD)] {
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        let prints = std::sync::atomic::AtomicUsize::new(0);
        let host = FakeHost::new(move |call| {
            let code = match call.args[0].as_str() {
                // Loaded, then unloaded after bootout, then stuck after the failure.
                "print" => match prints.fetch_add(1, std::sync::atomic::Ordering::SeqCst) {
                    1 => 3,
                    _ => 0,
                },
                "bootstrap" => 5,
                _ => 0,
            };
            Ok(crate::host::CommandOutput {
                code,
                stdout: String::new(),
                stderr: String::new(),
            })
        });
        let services = FakeCli::new(directory.path()).with_host(host.clone());
        let queue = open_queue(&state, &host);
        queue.set_setting("paused", prior_pause.clone()).unwrap();

        let (code, _, stderr) = main_with(&services, &state, &["install"]);

        assert_eq!(code, 1);
        assert!(
            stderr.contains("previous service recovery remains uncertain"),
            "{stderr}"
        );
        let expected = if prior_pause == json!(false) {
            json!("Browser worker installation recovery is uncertain; inspect before resuming")
        } else {
            prior_pause
        };
        assert_eq!(queue.get_setting("paused").unwrap(), Some(expected));
    }
}

#[test]
fn test_install_exclusively_holds_admission_and_restores_an_existing_pause() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let prior = "Browser storage recovery is pending";
    let host = launchctl(None);
    let queue = open_queue(&state, &host);
    queue.set_setting("paused", json!(prior)).unwrap();
    let during = Arc::new(Mutex::new(None));
    let (runtime, seen) = (queue.clone(), during.clone());
    host.set_responder(move |call| {
        if call.args[0] == "bootstrap" {
            *seen.lock().unwrap() = Some((
                runtime.get_setting("paused").unwrap(),
                runtime
                    .compare_set_pause(&json!(prior), &json!(false))
                    .unwrap(),
            ));
        }
        Ok(crate::host::CommandOutput {
            code: if call.args[0] == "print" { 3 } else { 0 },
            stdout: String::new(),
            stderr: String::new(),
        })
    });
    let services = FakeCli::new(directory.path()).with_host(host.clone());

    assert_eq!(main_with(&services, &state, &["install"]).0, 0);

    assert_eq!(
        *during.lock().unwrap(),
        Some((
            Some(json!("Browser worker installation in progress")),
            false
        ))
    );
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(prior)));
}

#[test]
fn test_inspect_only_enqueues_read_only_jobs_with_enabled_account() {
    let directory = tempfile::tempdir().unwrap();
    let mut services = FakeCli::new(directory.path());
    services.publishing = Accounts(vec![PublishingAccount {
        account_key: "ubc".into(),
        school_id: 3,
        instagram_user_id: "17840000000003".into(),
        instagram_username: "ubc.wat2do.io".into(),
        slug: Some("ubc".into()),
        recipient_id: Some("123".into()),
    }]);

    let (code, stdout, stderr) = main_with(
        &services,
        directory.path(),
        &[
            "inspect",
            "--school",
            "ubc",
            "--url",
            "https://www.instagram.com/p/abc/",
        ],
    );

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    let queue = open_queue(directory.path(), &services.host);
    let jobs: Vec<_> = result["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| queue.get(id.as_str().unwrap()).unwrap().unwrap())
        .collect();
    assert_eq!(jobs.len(), 1);
    assert!(!jobs[0].payload.contains_key("action"));
    for job in &jobs {
        assert!(job.dry_run());
        assert_eq!(job.state, "pending");
        assert_eq!(job.recipient_id, "123");
        assert_eq!(job.school, "ubc");
    }
}

#[test]
fn test_once_cannot_start_collector() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());

    assert_eq!(
        main_with(&services, directory.path(), &["worker", "--once"]).0,
        0
    );

    assert_eq!(*services.workers.lock().unwrap(), vec![(true, false)]);
}

#[test]
fn test_operator_can_pause_inspect_retry_and_cancel() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());
    let queue = open_queue(directory.path(), &services.host);
    let job_id = queue
        .enqueue_engagement(
            "ubc",
            "123",
            "ubc.wat2do.io",
            "https://www.instagram.com/p/abc/",
            None,
            false,
        )
        .unwrap();
    let state = directory.path();

    assert_eq!(main_with(&services, state, &["pause"]).0, 0);
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(true)));
    assert_eq!(
        main_with(&services, state, &["cancel", "--job-id", &job_id]).0,
        0
    );
    assert_eq!(queue.get(&job_id).unwrap().unwrap().state, "cancelled");
    assert_eq!(
        main_with(&services, state, &["retry", "--job-id", &job_id]).0,
        0
    );
    assert_eq!(queue.get(&job_id).unwrap().unwrap().state, "pending");
    assert_eq!(main_with(&services, state, &["resume"]).0, 0);
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(false)));
    let (code, stdout, _) = main_with(&services, state, &["status", "--job-id", &job_id]);
    assert_eq!(code, 0);
    assert_eq!(
        serde_json::from_str::<Value>(&stdout).unwrap()["id"],
        job_id
    );
}

#[test]
fn test_unknown_job_returns_failure() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());

    let (code, _, stderr) = main_with(
        &services,
        directory.path(),
        &["cancel", "--job-id", "missing"],
    );

    assert_eq!(code, 1);
    assert!(stderr.contains("does not exist"), "{stderr}");
}

#[test]
fn test_resume_preserves_installer_owned_pause() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());
    let queue = open_queue(directory.path(), &services.host);
    queue
        .set_setting("paused", json!(WORKER_INSTALLATION_PAUSE))
        .unwrap();

    let (code, _, stderr) = main_with(&services, directory.path(), &["resume"]);

    assert_eq!(code, 1);
    assert_eq!(
        queue.get_setting("paused").unwrap(),
        Some(json!(WORKER_INSTALLATION_PAUSE))
    );
    assert!(stderr.contains("installation before resuming"), "{stderr}");
}

#[test]
fn test_retrieve_sends_a_post_straight_to_the_ingestion_queue() {
    let directory = tempfile::tempdir().unwrap();
    let mut services = FakeCli::new(directory.path());
    services.school = Some(ubc());

    let (code, stdout, stderr) = main_with(
        &services,
        directory.path(),
        &[
            "retrieve",
            "--school",
            "ubc",
            "--url",
            "https://instagram.com/reel/AbC",
        ],
    );

    assert_eq!(code, 0, "{stderr}");
    assert_eq!(
        *services.queued.lock().unwrap(),
        vec![(
            vec!["https://www.instagram.com/reel/AbC/".to_owned()],
            "ubc".to_owned()
        )]
    );
    assert_eq!(
        serde_json::from_str::<Value>(&stdout).unwrap(),
        json!({"queued": 1})
    );
    // No browser work: Brave never opens a post.
    let queue = open_queue(directory.path(), &services.host);
    assert_eq!(queue.status().unwrap()["queues"], json!([]));
}

#[test]
fn test_retrieve_asks_brave_to_list_a_profile() {
    let directory = tempfile::tempdir().unwrap();
    let mut services = FakeCli::new(directory.path());
    services.school = Some(ubc());

    let (code, stdout, stderr) = main_with(
        &services,
        directory.path(),
        &["retrieve", "--school", "ubc", "--url", "@UBCClub"],
    );

    assert_eq!(code, 0, "{stderr}");
    let job_id = serde_json::from_str::<Value>(&stdout).unwrap()["job_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let queue = open_queue(directory.path(), &services.host);
    assert_eq!(
        queue.get(&job_id).unwrap().unwrap().payload["url"],
        "https://www.instagram.com/ubcclub/"
    );
    assert_eq!(
        queue
            .get_setting(&format!("profile_request:{job_id}"))
            .unwrap(),
        Some(json!(true))
    );
}

#[test]
fn test_install_refuses_a_host_without_launchd_before_touching_the_queue_pause() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let mut services = FakeCli::new(directory.path());
    services.mac = false;

    let (code, stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stdout.is_empty());
    assert_eq!(
        stderr,
        "The Instagram browser worker requires macOS and an existing Brave tab"
    );
    assert!(services.host.calls().is_empty());
    assert!(!services.plist().exists());
}

// The installed worker binary (`install_binary`) and the retry schedule.

/// `launchctl` as in `launchctl(None)`, and the installed binary answering its
/// `source-fingerprint` query with `fingerprint`.
fn mac_with_installed_binary(installed: PathBuf, fingerprint: &str) -> Arc<FakeHost> {
    let fingerprint = format!("{fingerprint}\n");
    FakeHost::new(move |call: &HostCall| {
        if call.program == "launchctl" {
            return Ok(crate::host::CommandOutput {
                code: if call.args[0] == "print" { 3 } else { 0 },
                stdout: String::new(),
                stderr: String::new(),
            });
        }
        assert_eq!(call.program, installed.display().to_string());
        assert_eq!(call.args, vec!["source-fingerprint".to_owned()]);
        ok(&fingerprint)
    })
}

fn launchctl_verbs(host: &FakeHost) -> Vec<String> {
    host.calls()
        .iter()
        .filter(|call| call.program == "launchctl")
        .map(|call| call.args[0].clone())
        .collect()
}

fn fingerprint_queries(host: &FakeHost) -> usize {
    host.calls()
        .iter()
        .filter(|call| call.program != "launchctl")
        .count()
}

#[test]
fn first_install_copies_the_binary_and_reports_it_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let binary = services.installed_binary();
    let host = mac_with_installed_binary(binary.clone(), FAKE_FINGERPRINT);
    let services = services.with_host(host.clone());

    let (code, stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(
        result["binary"],
        json!({
            "path": binary.display().to_string(),
            "replaced": true,
            "source_fingerprint": FAKE_FINGERPRINT,
            "automation": AUTOMATION_APPROVAL,
        })
    );
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "a built worker binary"
    );
    assert_eq!(mode(&binary), 0o755);
    // Nothing was installed yet, so there was nothing to ask.
    assert_eq!(fingerprint_queries(&host), 0);
}

#[test]
fn install_keeps_an_installed_binary_built_from_the_same_source() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let binary = services.installed_binary();
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "the installed worker binary").unwrap();
    let host = mac_with_installed_binary(binary.clone(), FAKE_FINGERPRINT);
    let services = services.with_host(host.clone());

    let (code, stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(result["binary"]["replaced"], false);
    assert_eq!(
        result["binary"]["automation"],
        "Unchanged; its Automation approval still applies"
    );
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "the installed worker binary"
    );
    assert_eq!(fingerprint_queries(&host), 1);
    assert_eq!(launchctl_verbs(&host), vec!["print", "enable", "bootstrap"]);
}

#[test]
fn install_replaces_an_installed_binary_built_from_other_source() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let binary = services.installed_binary();
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "the installed worker binary").unwrap();
    let host = mac_with_installed_binary(binary.clone(), "an-older-source");
    let services = services.with_host(host.clone());

    let (code, stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(result["binary"]["replaced"], true);
    assert_eq!(result["binary"]["automation"], AUTOMATION_APPROVAL);
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "a built worker binary"
    );
    assert_eq!(fingerprint_queries(&host), 1);
}

/// Ported from `tests/jobs/test_retry_failed_notifications.py`; the job is now the
/// `retry-failed-notifications` command of the installed binary.
#[test]
fn test_launch_agent_runs_daily_at_three() {
    let binary = Path::new("/installed/wat2do-browser");

    let payload = retry_launch_agent_payload(
        binary,
        Path::new("/state/notification-retry"),
        Path::new("/Users/someone/wat2do-runtime"),
    );

    assert_eq!(
        entry(&payload, "Label"),
        &Plist::from("io.wat2do.notification-retry")
    );
    assert_eq!(
        entry(&payload, "StartCalendarInterval"),
        &Plist::Dict(BTreeMap::from([
            ("Hour".to_owned(), Plist::Integer(3)),
            ("Minute".to_owned(), Plist::Integer(0)),
        ]))
    );
    assert_eq!(
        entry(&payload, "ProgramArguments"),
        &Plist::Array(vec![
            "/installed/wat2do-browser".into(),
            "retry-failed-notifications".into(),
        ])
    );
    let Plist::Dict(entries) = &payload else {
        panic!("not a dict");
    };
    assert!(!entries.contains_key("StartInterval"));
}

#[test]
fn install_retry_schedule_installs_only_its_agent_against_the_installed_binary() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let binary = services.installed_binary();
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "the installed worker binary").unwrap();
    let host = mac_with_installed_binary(binary.clone(), "an-older-source");
    let services = services.with_host(host.clone());

    let (code, stdout, stderr) = main_with(&services, &state, &["install-retry-schedule"]);

    assert_eq!(code, 0, "{stderr}");
    let result: Value = serde_json::from_str(&stdout).unwrap();
    let plist = services.agent_path(RETRY_LAUNCH_AGENT_LABEL);
    assert_eq!(result["installed"], RETRY_LAUNCH_AGENT_LABEL);
    assert_eq!(result["plist"], plist.display().to_string());
    assert_eq!(result["binary"], binary.display().to_string());
    assert_eq!(
        std::fs::read_to_string(&plist).unwrap(),
        launch_agents::to_xml(&retry_launch_agent_payload(
            &binary,
            &services.retry_state_directory(),
            &services.runtime_checkout(),
        ))
        .unwrap()
    );
    // Even an older installed worker binary is left alone: only `install` replaces it.
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "the installed worker binary"
    );
    assert_eq!(fingerprint_queries(&host), 0);
    assert_eq!(launchctl_verbs(&host), vec!["print", "enable", "bootstrap"]);
    assert!(!services.plist().exists());
}

#[test]
fn install_retry_schedule_needs_the_worker_installed_first() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());

    let (code, _stdout, stderr) = main_with(&services, &state, &["install-retry-schedule"]);

    assert_eq!(code, 1);
    assert!(stderr.starts_with("Install the worker first"), "{stderr}");
    assert!(services.host.calls().is_empty());
    assert!(!services.agent_path(RETRY_LAUNCH_AGENT_LABEL).exists());
    assert!(!services.installed_binary().exists());
}

#[test]
fn installs_refuse_uncommitted_or_unrecorded_builds() {
    for fingerprint in [
        format!("{FAKE_FINGERPRINT}-uncommitted"),
        "unrecorded".to_owned(),
    ] {
        for command in ["install", "install-retry-schedule"] {
            let directory = tempfile::tempdir().unwrap();
            let state = directory.path().join("state");
            let mut services = FakeCli::new(directory.path());
            services.fingerprint = fingerprint.clone();
            std::fs::create_dir_all(services.installed_binary().parent().unwrap()).unwrap();
            std::fs::write(services.installed_binary(), "the installed worker binary").unwrap();

            let (code, _stdout, stderr) = main_with(&services, &state, &[command]);

            assert_eq!(code, 1, "{command} {fingerprint}");
            assert!(
                stderr.contains("uncommitted or unrecorded sources"),
                "{stderr}"
            );
            assert!(services.host.calls().is_empty());
            assert!(!services.plist().exists());
            assert!(!services.agent_path(RETRY_LAUNCH_AGENT_LABEL).exists());
            assert_eq!(
                std::fs::read_to_string(services.installed_binary()).unwrap(),
                "the installed worker binary"
            );
        }
    }
}

#[test]
fn installs_refuse_a_binary_built_outside_the_runtime_checkout() {
    for command in ["install", "install-retry-schedule"] {
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        let mut services = FakeCli::new(directory.path());
        services.checkout = directory.path().join("wat2do-rs-brave");
        std::fs::create_dir_all(services.installed_binary().parent().unwrap()).unwrap();
        std::fs::write(services.installed_binary(), "the installed worker binary").unwrap();

        let (code, _stdout, stderr) = main_with(&services, &state, &[command]);

        assert_eq!(code, 1, "{command}");
        assert!(
            stderr.starts_with("Install from the runtime checkout"),
            "{stderr}"
        );
        assert!(stderr.contains("wat2do-rs-brave"), "{stderr}");
        assert!(services.host.calls().is_empty());
        assert!(!services.plist().exists());
        assert!(!services.agent_path(RETRY_LAUNCH_AGENT_LABEL).exists());
    }
}

#[test]
fn a_failed_install_puts_the_previous_binary_back() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let binary = services.installed_binary();
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "the installed worker binary").unwrap();
    let host = FakeHost::new(|call| {
        if call.program == "launchctl" {
            let code = match call.args[0].as_str() {
                "print" => 1,
                "bootstrap" => 5,
                _ => 0,
            };
            return Ok(CommandOutput {
                code,
                stdout: String::new(),
                stderr: String::new(),
            });
        }
        // The installed binary answers that it was built from older source.
        ok("an-older-source\n")
    });
    let services = services.with_host(host.clone());
    let queue = open_queue(&state, &host);

    let (code, _stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1, "{stderr}");
    assert_eq!(
        std::fs::read_to_string(&binary).unwrap(),
        "the installed worker binary"
    );
    assert!(!binary.with_extension("previous").exists());
    assert!(!binary.with_extension("partial").exists());
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(false)));
}

#[test]
fn a_failed_first_install_leaves_no_binary() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let services = FakeCli::new(directory.path());
    let host = FakeHost::new(|call| {
        let code = match call.args[0].as_str() {
            "print" => 1,
            "bootstrap" => 5,
            _ => 0,
        };
        Ok(CommandOutput {
            code,
            stdout: String::new(),
            stderr: String::new(),
        })
    });
    let services = services.with_host(host.clone());

    let (code, _stdout, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1, "{stderr}");
    assert!(!services.installed_binary().exists());
}

// Races Python staged by monkeypatching `compare_set_pause`.

fn hook_compare_set_pause(
    state: &Path,
    hook: impl FnMut(&BrowserJobQueue) -> Option<bool> + Send + 'static,
) {
    crate::instagram_notifications::browser_queue::compare_set_pause_hooks::install(
        state.join("jobs.sqlite3"),
        Box::new(hook),
    );
}

#[test]
fn test_install_acquisition_cannot_replace_an_auth_hold_written_after_its_read() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = FakeHost::new(|_| panic!("must preserve the newly acquired auth hold"));
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);
    let newer = open_queue(&state, &host);
    hook_compare_set_pause(&state, move |_| {
        newer.set_setting("paused", json!(AUTH_HOLD)).unwrap();
        None
    });

    let (code, _, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stderr.contains("pause changed during setup"), "{stderr}");
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(AUTH_HOLD)));
    assert!(host.calls().is_empty());
}

#[test]
fn test_install_lost_acquisition_fails_before_service_changes_if_pause_is_false() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state");
    let host = FakeHost::new(|_| panic!("must not replace an unpaused worker"));
    let services = FakeCli::new(directory.path()).with_host(host.clone());
    let queue = open_queue(&state, &host);
    hook_compare_set_pause(&state, |_| Some(false));

    let (code, _, stderr) = main_with(&services, &state, &["install"]);

    assert_eq!(code, 1);
    assert!(stderr.contains("pause changed during setup"), "{stderr}");
    assert_eq!(
        queue.setting_or("paused", json!(false)).unwrap(),
        json!(false)
    );
    assert!(host.calls().is_empty());
    assert!(!services.installed_binary().exists());
}

#[test]
fn test_resume_cannot_erase_a_concurrent_safety_hold() {
    let directory = tempfile::tempdir().unwrap();
    let hold = "Instagram requires human account recovery";
    let services = FakeCli::new(directory.path());
    hook_compare_set_pause(directory.path(), move |queue| {
        queue.set_setting("paused", json!(hold)).unwrap();
        None
    });

    let (code, _, stderr) = main_with(&services, directory.path(), &["resume"]);

    assert_eq!(code, 1);
    let queue = open_queue(directory.path(), &services.host);
    assert_eq!(queue.get_setting("paused").unwrap(), Some(json!(hold)));
    assert!(stderr.contains("pause changed"), "{stderr}");
}

#[test]
fn the_follow_crawl_queues_a_following_page_and_reads_it_back_by_job_id() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());
    let (code, stdout, stderr) = main_with(
        &services,
        directory.path(),
        &[
            "following",
            "--school=ubc",
            "--crawl=crawl-1",
            "--username=UBC.Club",
            "--max-id=-QVFE+/=",
        ],
    );
    assert_eq!(code, 0, "{stderr}");
    let job_id = serde_json::from_str::<Value>(&stdout).unwrap()["job_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (code, stdout, _) = main_with(
        &services,
        directory.path(),
        &["status", &format!("--job-id={job_id}")],
    );
    assert_eq!(code, 0);
    let job: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(job["kind"], "following");
    assert_eq!(job["account_username"], "wat2do.ubc");
    assert_eq!(
        job["payload"],
        json!({"crawl": "crawl-1", "username": "ubc.club", "user_id": null, "max_id": "-QVFE+/="})
    );
    let (code, _, stderr) = main_with(&services, directory.path(), &["status", "--job-id=missing"]);
    assert_eq!(code, 1);
    assert!(stderr.contains("job does not exist"), "{stderr}");
}

#[test]
fn following_reads_alone_can_be_stopped_and_started_again() {
    let directory = tempfile::tempdir().unwrap();
    let services = FakeCli::new(directory.path());
    let (code, stdout, _) = main_with(&services, directory.path(), &["pause-following"]);
    assert_eq!(code, 0);
    assert!(serde_json::from_str::<Value>(&stdout).unwrap()["following_paused"].is_string());
    let queue = open_queue(directory.path(), &services.host);
    assert!(!queue.paused().unwrap());
    let (_, stdout, _) = main_with(&services, directory.path(), &["status"]);
    assert!(serde_json::from_str::<Value>(&stdout).unwrap()["following"]["paused"].is_string());
    let (code, stdout, _) = main_with(&services, directory.path(), &["resume-following"]);
    assert_eq!(code, 0);
    assert_eq!(
        serde_json::from_str::<Value>(&stdout).unwrap()["following_paused"],
        json!(false)
    );
}
