//! `wat2do-browser`: operate the Mac mini's shared Instagram browser worker and its
//! durable queue, and process forwarded Instagram notifications
//! (`backend/scripts/instagram_browser.py` and `backend/jobs/process_notification.py`).
//!
//! `install` keeps `worker` alive as the LaunchAgent `io.wat2do.instagram-browser.worker`;
//! the `process-notification` GitHub workflow runs `process-notification` and `retrieve`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use tracing::Level;

use super::browser_ingestion::canonical_target_url;
use super::browser_queue::{BrowserJobQueue, WORKER_INSTALLATION_PAUSE};
use super::browser_session::{Bridge, canonical_post_url, school_account_username};
use super::browser_worker::{Worker, handle_stop_signals};
use super::carousel_engagement::{self, PublishingStore};
use super::errors::BrowserError;
use super::process_notification::{self, Level as LogLevel, LiveServices};
use crate::controlbox::instagram_browser as control;
use crate::db::BlockingPool;
use crate::host::{Event, Host, RealHost};
use crate::launch_agents::{self, Launchctl, Plist};
use crate::schools::SchoolRouting;
use crate::{logs, python_json};

pub const LAUNCH_AGENT_LABEL: &str = "io.wat2do.instagram-browser.worker";
pub const RETRY_LAUNCH_AGENT_LABEL: &str = "io.wat2do.notification-retry";
/// What a person does after a new worker binary is installed.
pub const AUTOMATION_APPROVAL: &str = "Replaced: on its first browser job, allow wat2do-browser to control Brave Browser (System Settings > Privacy & Security > Automation), then resume the worker";

/// What the commands reach beyond the local queue; tests replace each of them.
pub trait CliServices {
    fn host(&self) -> Arc<dyn Host>;
    /// `school_service.get_school`.
    fn school_by_slug(&self, slug: &str) -> anyhow::Result<Option<SchoolRouting>>;
    /// The publishing tables.
    fn publishing(&self) -> anyhow::Result<&dyn PublishingStore>;
    /// `items.queue_instagram`: how many posts were new to the ingestion queue.
    fn queue_posts(&self, urls: &[String], school: &str) -> anyhow::Result<usize>;
    /// Run the worker until it stops.
    fn run_worker(
        &self,
        queue: Arc<BrowserJobQueue>,
        once: bool,
        collect: bool,
    ) -> anyhow::Result<()>;
    /// Where the LaunchAgent plist lives.
    fn agent_path(&self, label: &str) -> PathBuf;
    /// `launchctl`, waiting `timeout` for each call and polling every `poll_interval`.
    fn launchctl(&self, timeout: Duration, poll_interval: Duration) -> anyhow::Result<Launchctl>;
    /// Whether this is a Mac, the only host with launchd and the worker's Brave.
    fn is_mac(&self) -> bool;
    /// Where the LaunchAgents' worker binary is installed.
    fn installed_binary(&self) -> PathBuf;
    /// This binary, the copy `install` puts in place.
    fn current_binary(&self) -> anyhow::Result<PathBuf>;
    /// Where the daily notification retry keeps its state and logs.
    fn retry_state_directory(&self) -> PathBuf;
    /// The source this binary was built from (`SOURCE_FINGERPRINT`).
    fn source_fingerprint(&self) -> String;
    /// The checkout this binary was built from.
    fn checkout(&self) -> PathBuf;
    /// The live runtime checkout, the only one the LaunchAgents may run from.
    fn runtime_checkout(&self) -> PathBuf;
}

/// The real Mac and database, connected on first use.
#[derive(Default)]
pub struct LiveCli {
    db: std::sync::OnceLock<BlockingPool>,
}

impl LiveCli {
    fn database(&self) -> anyhow::Result<&BlockingPool> {
        if let Some(db) = self.db.get() {
            return Ok(db);
        }
        let db = BlockingPool::connect(2)?;
        Ok(self.db.get_or_init(|| db))
    }
}

impl CliServices for LiveCli {
    fn host(&self) -> Arc<dyn Host> {
        RealHost::shared()
    }

    fn school_by_slug(&self, slug: &str) -> anyhow::Result<Option<SchoolRouting>> {
        let slug = slug.to_owned();
        self.database()?
            .run(|pool| async move { crate::schools::routing_by_slug(&pool, &slug).await })
    }

    fn publishing(&self) -> anyhow::Result<&dyn PublishingStore> {
        Ok(self.database()?)
    }

    fn queue_posts(&self, urls: &[String], school: &str) -> anyhow::Result<usize> {
        let (urls, school) = (urls.to_vec(), school.to_owned());
        self.database()?.run(|pool| async move {
            crate::ingestion::items::queue_instagram(&pool, &urls, &school).await
        })
    }

    fn run_worker(
        &self,
        queue: Arc<BrowserJobQueue>,
        once: bool,
        collect: bool,
    ) -> anyhow::Result<()> {
        logs::init_worker_log(
            queue.state_directory.join("worker.operations.log"),
            control().worker_log_max_bytes,
            control().worker_log_backup_count,
        );
        let db = match BlockingPool::connect_lazy(3) {
            Ok(db) => Some(Arc::new(db)),
            Err(error) => {
                tracing::error!("Browser worker has no database: {error:#}");
                None
            }
        };
        let worker = Worker::new(Bridge::real(), queue, db);
        let terminate = Arc::new(Event::default());
        handle_stop_signals(terminate.clone());
        worker.run(once, collect, terminate)?;
        Ok(())
    }

    fn agent_path(&self, label: &str) -> PathBuf {
        launch_agents::agent_path(label)
    }

    fn launchctl(&self, timeout: Duration, poll_interval: Duration) -> anyhow::Result<Launchctl> {
        // An interrupted install puts the previous agent back before it stops.
        Launchctl::new(self.host(), timeout, poll_interval).stop_on_signals()
    }

    fn is_mac(&self) -> bool {
        cfg!(target_os = "macos")
    }

    fn installed_binary(&self) -> PathBuf {
        launch_agents::installed_binary_path()
    }

    fn current_binary(&self) -> anyhow::Result<PathBuf> {
        Ok(std::env::current_exe()?)
    }

    fn retry_state_directory(&self) -> PathBuf {
        crate::notification_retry::state_directory()
    }

    fn source_fingerprint(&self) -> String {
        SOURCE_FINGERPRINT.to_owned()
    }

    fn checkout(&self) -> PathBuf {
        launch_agents::repository_directory()
    }

    fn runtime_checkout(&self) -> PathBuf {
        launch_agents::home().join("wat2do-runtime")
    }
}

/// Parse the command line and run it, as the `wat2do-browser` binary.
pub fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::ProcessNotification => return process_notification(),
        Command::SourceFingerprint => {
            println!("{SOURCE_FINGERPRINT}");
            return ExitCode::SUCCESS;
        }
        Command::RetryFailedNotifications => return retry_failed_notifications(),
        _ => {}
    }
    logs::init_stderr(logs::Style::LevelTarget, Level::WARN);
    let (code, stdout, stderr) = run(cli, &LiveCli::default());
    if !stdout.is_empty() {
        println!("{stdout}");
    }
    if !stderr.is_empty() {
        eprintln!("{stderr}");
    }
    ExitCode::from(code)
}

/// Run one operator command: its exit code, what it prints and what it reports.
pub fn run(cli: Cli, services: &dyn CliServices) -> (u8, String, String) {
    match operate(cli, services) {
        Ok(Some(result)) => (0, python_json::dumps_pretty_sorted(&result), String::new()),
        Ok(None) => (0, String::new(), String::new()),
        Err(error) => (1, String::new(), describe(&error)),
    }
}
#[derive(Parser)]
#[command(about = "Operate the Mac mini's shared Instagram browser worker and durable queues")]
pub struct Cli {
    /// Defaults to the current user's shared state directory
    #[arg(long, global = true)]
    pub state_directory: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Run the single browser executor and published-carousel collector
    Worker {
        /// Process one bounded queued batch, without collecting
        #[arg(long)]
        once: bool,
        /// Execute queued jobs without polling published carousels
        #[arg(long)]
        no_collect: bool,
    },
    /// Queue a post for ingestion, or a profile for Brave to list its recent posts
    Retrieve {
        #[arg(long)]
        school: String,
        #[arg(long)]
        url: String,
        #[arg(long, default_value_t = 1)]
        cutoff_days: i64,
    },
    /// Install this binary and start the macOS worker LaunchAgent
    Install,
    /// Install this binary and the daily LaunchAgent that reruns failed notification runs
    InstallRetrySchedule,
    /// Log Brave back in and rerun failed Process Notifications runs, once
    RetryFailedNotifications,
    /// Show worker health and queue quantities by school
    Status {
        /// Inspect the full result of one job
        #[arg(long)]
        job_id: Option<String>,
    },
    /// Queue original posts from newly published carousel selections
    Sync,
    /// Pause browser work after the current job finishes
    Pause,
    /// Resume after inspecting any uncertain browser activity
    Resume,
    Retry {
        #[arg(long)]
        job_id: String,
    },
    Cancel {
        #[arg(long)]
        job_id: String,
    },
    /// Queue read-only action checks in the shared browser
    Inspect {
        #[arg(long)]
        school: String,
        #[arg(long)]
        url: String,
    },
    /// Record the posts of the notification in NOTIFICATION_JSON (GitHub's job)
    ProcessNotification,
    /// Print the source this binary was built from (`scripts/notification-binary.sh`)
    #[command(hide = true)]
    SourceFingerprint,
}

/// The committed sources this binary was built from (`browser-worker-sources.txt`, see
/// `build.rs`), with "-uncommitted" when some of them had local changes.
pub const SOURCE_FINGERPRINT: &str = env!("WAT2DO_SOURCE_FINGERPRINT");

/// What the operator sees for a failure: the message of an expected refusal, only the
/// kind of a storage or system failure.
fn describe(error: &anyhow::Error) -> String {
    match error.downcast_ref::<BrowserError>() {
        Some(BrowserError::Storage(_)) => {
            "Instagram browser operation failed (OperationalError)".to_owned()
        }
        Some(BrowserError::Other { type_name, .. }) if type_name == "OSError" => {
            "Instagram browser operation failed (OSError)".to_owned()
        }
        Some(error) => error.to_string(),
        None if error.downcast_ref::<sqlx::Error>().is_some() => {
            "Instagram browser operation failed (DatabaseError)".to_owned()
        }
        None => error.to_string(),
    }
}

fn process_notification() -> ExitCode {
    logs::init_stderr(logs::Style::Timestamped, Level::INFO);
    let github = std::env::var("GITHUB_ACTIONS").as_deref() == Ok("true");
    let mut errors = Vec::new();
    let mut services = LiveServices::default();
    let processed = process_notification::process(
        &std::env::var("NOTIFICATION_JSON").unwrap_or_default(),
        &std::env::var("INTENDED_RECIPIENT_ID").unwrap_or_default(),
        &mut services,
        &mut |level, message| match level {
            LogLevel::Info => tracing::info!("{message}"),
            LogLevel::Warning => tracing::warn!("{message}"),
            LogLevel::Error => {
                tracing::error!("{message}");
                errors.push(message);
            }
        },
    );
    if let Some(notice) = processed.notice.filter(|_| github) {
        println!("::notice::{notice}");
    }
    if let Some(annotation) = process_notification::error_annotation(&errors).filter(|_| github) {
        eprintln!("{annotation}");
    }
    ExitCode::from(processed.exit_code as u8)
}

fn operate(cli: Cli, services: &dyn CliServices) -> anyhow::Result<Option<Value>> {
    let host = services.host();
    let queue = BrowserJobQueue::open(cli.state_directory.as_deref(), host.clone())?;
    let result = match cli.command {
        Command::Worker { once, no_collect } => {
            services.run_worker(queue, once, !no_collect && !once)?;
            return Ok(None);
        }
        Command::Install => {
            if !services.is_mac() {
                anyhow::bail!(
                    "The Instagram browser worker requires macOS and an existing Brave tab"
                );
            }
            install(&queue, services, host.as_ref())?
        }
        Command::Status {
            job_id: Some(job_id),
        } => queue
            .get(&job_id)?
            .ok_or_else(|| BrowserError::Value("Instagram browser job does not exist".to_owned()))?
            .to_value(),
        Command::Status { job_id: None } => queue.status()?,
        Command::Pause => {
            queue.set_setting("paused", Value::Bool(true))?;
            json!({"paused": queue.get_setting("paused")?})
        }
        Command::Resume => {
            let prior = queue.setting_or("paused", Value::Bool(false))?;
            if prior == json!(WORKER_INSTALLATION_PAUSE) {
                anyhow::bail!("Wait for browser worker installation before resuming");
            }
            if !queue.compare_set_pause(&prior, &Value::Bool(false))? {
                anyhow::bail!("Browser worker pause changed; inspect before resuming");
            }
            json!({"paused": queue.get_setting("paused")?})
        }
        Command::Retry { job_id } => {
            let job = queue.get(&job_id)?.ok_or_else(|| {
                BrowserError::Value("Instagram browser job does not exist".to_owned())
            })?;
            if job.kind == "retrieval" {
                queue.retry_retrieval(&job_id)?;
            } else {
                queue.retry(&job_id)?;
            }
            updated(&queue, &job_id)?
        }
        Command::Cancel { job_id } => {
            queue.get(&job_id)?.ok_or_else(|| {
                BrowserError::Value("Instagram browser job does not exist".to_owned())
            })?;
            queue.cancel(&job_id)?;
            updated(&queue, &job_id)?
        }
        Command::Retrieve {
            school,
            url,
            cutoff_days,
        } => {
            let school = services
                .school_by_slug(&school)?
                .filter(|school| {
                    school
                        .recipient_id
                        .as_deref()
                        .is_some_and(|id| !id.is_empty())
                })
                .ok_or_else(|| {
                    BrowserError::Value(
                        "School has no configured notification recipient".to_owned(),
                    )
                })?;
            let target = canonical_target_url(&url)?;
            if let Ok(post_url) = canonical_post_url(&target) {
                // A post needs no login: it goes straight to the ingestion queue.
                json!({"queued": services.queue_posts(&[post_url], &school.slug)?})
            } else {
                // Listing a profile's posts needs the login, so Brave does it.
                let job_id = queue.enqueue_retrieval(
                    &school.slug,
                    school.recipient_id.as_deref().unwrap_or_default(),
                    &school_account_username(&school.slug).map_err(BrowserError::Value)?,
                    &target,
                    cutoff_days,
                )?;
                queue.set_setting(&format!("profile_request:{job_id}"), Value::Bool(true))?;
                json!({"job_id": job_id})
            }
        }
        Command::Sync => {
            carousel_engagement::sync_published_carousels(&queue, services.publishing()?, None)?
        }
        Command::Inspect { school, url } => {
            let identity =
                carousel_engagement::get_engagement_account(services.publishing()?, &school)?;
            json!({"jobs": [queue.enqueue_engagement(
                &identity.school,
                &identity.recipient_id,
                &identity.account_username,
                &url,
                None,
                true,
            )?]})
        }
        Command::InstallRetrySchedule => {
            if !services.is_mac() {
                anyhow::bail!("The notification retry requires macOS and the worker's Brave");
            }
            install_retry_schedule(services)?
        }
        Command::ProcessNotification
        | Command::SourceFingerprint
        | Command::RetryFailedNotifications => {
            unreachable!("handled before the queue opens")
        }
    };
    Ok(Some(result))
}

fn updated(queue: &BrowserJobQueue, job_id: &str) -> anyhow::Result<Value> {
    Ok(queue
        .get(job_id)?
        .ok_or_else(|| anyhow::anyhow!("Instagram browser job disappeared during the operation"))?
        .to_value())
}

/// The worker LaunchAgent: the installed binary, the stable checkout's `backend/` (for
/// its `.env`) and the same user's spool across runner checkouts.
pub fn launch_agent_payload(queue: &BrowserJobQueue, binary: &Path, checkout: &Path) -> Plist {
    let state_directory = queue
        .state_directory
        .canonicalize()
        .unwrap_or_else(|_| queue.state_directory.clone());
    let log = |name: &str| Plist::from(queue.state_directory.join(name).display().to_string());
    Plist::Dict(BTreeMap::from([
        ("Label".to_owned(), LAUNCH_AGENT_LABEL.into()),
        (
            "ProgramArguments".to_owned(),
            Plist::Array(vec![
                binary.display().to_string().into(),
                "--state-directory".into(),
                state_directory.display().to_string().into(),
                "worker".into(),
            ]),
        ),
        (
            "WorkingDirectory".to_owned(),
            checkout.join("backend").display().to_string().into(),
        ),
        (
            "EnvironmentVariables".to_owned(),
            Plist::Dict(BTreeMap::from([(
                "PATH".to_owned(),
                "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".into(),
            )])),
        ),
        ("RunAtLoad".to_owned(), Plist::Bool(true)),
        ("KeepAlive".to_owned(), Plist::Bool(true)),
        ("ProcessType".to_owned(), "Background".into()),
        ("StandardOutPath".to_owned(), log("worker.stdout.log")),
        ("StandardErrorPath".to_owned(), log("worker.stderr.log")),
    ]))
}

/// The daily LaunchAgent that reruns failed notification runs, on the same binary so
/// one Automation approval covers both.
pub fn retry_launch_agent_payload(binary: &Path, state_directory: &Path, checkout: &Path) -> Plist {
    let retry = crate::controlbox::notification_retry();
    let log = |name: &str| Plist::from(state_directory.join(name).display().to_string());
    Plist::Dict(BTreeMap::from([
        ("Label".to_owned(), RETRY_LAUNCH_AGENT_LABEL.into()),
        (
            "ProgramArguments".to_owned(),
            Plist::Array(vec![
                binary.display().to_string().into(),
                "retry-failed-notifications".into(),
            ]),
        ),
        (
            "WorkingDirectory".to_owned(),
            checkout.join("backend").display().to_string().into(),
        ),
        (
            "EnvironmentVariables".to_owned(),
            Plist::Dict(BTreeMap::from([(
                "PATH".to_owned(),
                launch_agents::claude_code_path().into(),
            )])),
        ),
        (
            "StartCalendarInterval".to_owned(),
            Plist::Dict(BTreeMap::from([
                (
                    "Hour".to_owned(),
                    Plist::Integer(i64::from(retry.schedule_hour)),
                ),
                (
                    "Minute".to_owned(),
                    Plist::Integer(i64::from(retry.schedule_minute)),
                ),
            ])),
        ),
        ("ProcessType".to_owned(), "Background".into()),
        ("StandardOutPath".to_owned(), log("retry.stdout.log")),
        ("StandardErrorPath".to_owned(), log("retry.stderr.log")),
    ]))
}

/// The checkout an install may point the LaunchAgents at: the runtime checkout, built
/// from committed sources, so the plist never names a task worktree and the installed
/// binary's fingerprint names exactly what it runs.
fn installable_checkout(services: &dyn CliServices) -> anyhow::Result<PathBuf> {
    let fingerprint = services.source_fingerprint();
    if fingerprint == "unrecorded" || fingerprint.ends_with("-uncommitted") {
        anyhow::bail!(
            "This binary was built from uncommitted or unrecorded sources ({fingerprint}); build the runtime checkout's committed code before installing"
        );
    }
    let checkout = services.checkout();
    let runtime = services.runtime_checkout();
    let same = match (checkout.canonicalize(), runtime.canonicalize()) {
        (Ok(checkout), Ok(runtime)) => checkout == runtime,
        _ => false,
    };
    if !same {
        anyhow::bail!(
            "Install from the runtime checkout ({}); this binary was built in {}",
            runtime.display(),
            checkout.display()
        );
    }
    Ok(checkout)
}

/// Put this binary where the LaunchAgents run it, unless the same source is there.
fn install_worker_binary(
    services: &dyn CliServices,
    host: &dyn Host,
) -> anyhow::Result<launch_agents::BinaryInstall> {
    Ok(launch_agents::install_binary(
        host,
        &services.current_binary()?,
        &services.installed_binary(),
        &services.source_fingerprint(),
    )?)
}

/// What `install` reports about the binary.
fn binary_report(services: &dyn CliServices, binary: &Path, replaced: bool) -> Value {
    json!({
        "path": binary.display().to_string(),
        "replaced": replaced,
        "source_fingerprint": services.source_fingerprint(),
        "automation": if replaced { AUTOMATION_APPROVAL } else { "Unchanged; its Automation approval still applies" },
    })
}

/// The daily retry runs the worker's installed binary; it never replaces it, so the
/// worker's Automation approval is changed only by `install`.
fn install_retry_schedule(services: &dyn CliServices) -> anyhow::Result<Value> {
    let checkout = installable_checkout(services)?;
    let binary = services.installed_binary();
    if !binary.is_file() {
        anyhow::bail!(
            "Install the worker first (wat2do-browser install): the daily retry runs its installed binary {}",
            binary.display()
        );
    }
    let state_directory = services.retry_state_directory();
    std::fs::create_dir_all(&state_directory)?;
    let destination = services.agent_path(RETRY_LAUNCH_AGENT_LABEL);
    launch_agents::install_launch_agent(
        &destination,
        RETRY_LAUNCH_AGENT_LABEL,
        &retry_launch_agent_payload(&binary, &state_directory, &checkout),
        &services.launchctl(
            Duration::from_secs_f64(
                crate::controlbox::notification_retry().launch_agent_timeout_seconds,
            ),
            Duration::from_secs(1),
        )?,
    )?;
    Ok(json!({
        "installed": RETRY_LAUNCH_AGENT_LABEL,
        "plist": destination.display().to_string(),
        "binary": binary.display().to_string(),
    }))
}

/// The `retry-failed-notifications` command: one pass, printed as sorted JSON.
fn retry_failed_notifications() -> ExitCode {
    logs::init_stderr(logs::Style::Colons, Level::INFO);
    let host = RealHost::shared();
    let services = crate::notification_retry::Live { host: host.clone() };
    let state = crate::notification_retry::state_directory().join("state.json");
    let (code, printed) = crate::notification_retry::run_once(&services, &state, &|| host.time());
    println!("{printed}");
    ExitCode::from(code)
}

fn install(
    queue: &BrowserJobQueue,
    services: &dyn CliServices,
    host: &dyn Host,
) -> anyhow::Result<Value> {
    use fs2::FileExt;
    let checkout = installable_checkout(services)?;
    let destination = &services.agent_path(LAUNCH_AGENT_LABEL);
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(queue.state_directory.join("worker-install.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        anyhow::bail!("Another browser worker installation is still running");
    }
    let previous_pause = queue.setting_or("paused", Value::Bool(false))?;
    let hold = json!(WORKER_INSTALLATION_PAUSE);
    if !queue.compare_set_pause(&previous_pause, &hold)? {
        anyhow::bail!("Browser worker pause changed during setup; inspect before retrying");
    }
    let mut report = Value::Null;
    let installed = (|| -> anyhow::Result<()> {
        let running = queue.status()?["queues"].as_array().is_some_and(|groups| {
            groups
                .iter()
                .any(|group| group["state"] == json!("running"))
        });
        if running {
            anyhow::bail!("Wait for the current browser jobs to finish before installing");
        }
        let binary = install_worker_binary(services, host)?;
        report = binary_report(services, &binary.destination, binary.replaced);
        let payload = launch_agent_payload(queue, &binary.destination, &checkout);
        let launchctl = services.launchctl(
            Duration::from_secs_f64(control().request_timeout_seconds),
            Duration::from_secs_f64(control().worker_poll_interval_seconds),
        )?;
        match launch_agents::install_launch_agent(
            destination,
            LAUNCH_AGENT_LABEL,
            &payload,
            &launchctl,
        ) {
            Ok(()) => {
                binary.keep();
                Ok(())
            }
            // The service was not replaced: neither is the binary it runs.
            Err(error) => {
                binary.restore()?;
                Err(error)
            }
        }
    })();
    if let Err(error) = &installed
        && error
            .downcast_ref::<launch_agents::RecoveryUncertain>()
            .is_some()
    {
        let restored = if python_json::truthy(&previous_pause) {
            previous_pause.clone()
        } else {
            json!("Browser worker installation recovery is uncertain; inspect before resuming")
        };
        queue.compare_set_pause(&hold, &restored)?;
    }
    queue.compare_set_pause(&hold, &previous_pause)?;
    installed?;
    Ok(json!({
        "installed": LAUNCH_AGENT_LABEL,
        "plist": destination.display().to_string(),
        "binary": report,
    }))
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/cli.rs"]
mod python_tests;

#[cfg(test)]
mod fingerprint_tests {
    use super::SOURCE_FINGERPRINT;

    /// build.rs and the workflow's script must agree on a committed checkout, or every
    /// workflow run would rebuild (and then refuse) its binary.
    #[test]
    fn the_embedded_fingerprint_matches_the_workflow_script() {
        if SOURCE_FINGERPRINT.ends_with("-uncommitted") || SOURCE_FINGERPRINT == "unrecorded" {
            return;
        }
        let repository = crate::launch_agents::repository_directory();
        let output = std::process::Command::new("bash")
            .arg(repository.join("scripts/notification-binary.sh"))
            .arg("fingerprint")
            .output()
            .expect("bash runs the script");
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            SOURCE_FINGERPRINT
        );
    }
}
