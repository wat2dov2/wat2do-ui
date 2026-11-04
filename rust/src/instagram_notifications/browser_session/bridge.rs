//! The one transport to Brave: `osascript`, serialized behind a process-wide lock.
//!
//! Page loads are paced by `navigation_interval_seconds`, a timed-out or refused Apple
//! Event becomes a sanitized error, and only explicitly idempotent reads retry.

use std::cell::Cell;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use parking_lot::{Mutex, ReentrantMutex};
use regex::Regex;

use super::super::account_login::{ImapMailbox, Mailbox};
use super::super::errors::{BrowserError, BrowserResult};
use super::super::scripts;
use crate::controlbox::instagram_browser as control;
use crate::host::{CommandError, Host, RealHost};

pub const OSASCRIPT: &str = "/usr/bin/osascript";
const IOREG: &str = "/usr/sbin/ioreg";
pub const TIMED_OUT: &str = "Brave browser automation timed out";
pub const TAB_CLOSED: &str = "The pinned Instagram tab was closed";
pub const TAB_LOADING: &str = "The pinned Instagram tab is loading";
const JOB_DEADLINE_EXCEEDED: &str = "Instagram browser job exceeded its deadline";

/// Brave, the clocks and the Gmail inbox, shared by every tab of one worker process.
pub struct Bridge {
    pub host: Arc<dyn Host>,
    pub mailbox: Arc<dyn Mailbox>,
    applescript: ReentrantMutex<()>,
    /// When the last page load was dispatched, for pacing.
    navigation: Mutex<Option<f64>>,
}

impl Bridge {
    pub fn new(host: Arc<dyn Host>, mailbox: Arc<dyn Mailbox>) -> Arc<Self> {
        Arc::new(Self {
            host,
            mailbox,
            applescript: ReentrantMutex::new(()),
            navigation: Mutex::new(None),
        })
    }

    /// Python's `_NAVIGATION_LOCK` and `_LAST_NAVIGATION_AT`, for tests.
    #[cfg(test)]
    pub(crate) fn navigation_gate(&self) -> &Mutex<Option<f64>> {
        &self.navigation
    }

    /// Python's `_APPLESCRIPT_LOCK`, for tests.
    #[cfg(test)]
    pub(crate) fn transport(&self) -> &ReentrantMutex<()> {
        &self.applescript
    }

    /// The real Mac and Gmail.
    pub fn real() -> Arc<Self> {
        Self::new(RealHost::shared(), Arc::new(ImapMailbox))
    }

    pub fn monotonic(&self) -> f64 {
        self.host.monotonic()
    }

    pub fn time(&self) -> f64 {
        self.host.time()
    }

    /// `time.sleep`, cut short (with an error) when this thread's job deadline or a
    /// stop request arrives, as Python's signal handlers interrupted the main thread.
    pub fn sleep(&self, seconds: f64) -> BrowserResult<()> {
        let mut left = seconds;
        loop {
            self.check()?;
            if left <= 0.0 {
                return Ok(());
            }
            let mut slice = left;
            if guarded() {
                slice = slice.min(0.1);
                if let Some(deadline) = job_deadline() {
                    slice = slice.min((deadline - self.monotonic()).max(0.0));
                }
            }
            let started = self.monotonic();
            self.host.sleep(slice);
            left -= (self.monotonic() - started).max(slice);
        }
    }

    /// Raise this thread's pending job timeout or stop request.
    pub fn check(&self) -> BrowserResult<()> {
        if INTERRUPTIBLE.with(Cell::get) && STOPPING.load(Ordering::SeqCst) {
            return Err(BrowserError::Interrupted);
        }
        if let Some(deadline) = job_deadline()
            && self.monotonic() >= deadline
        {
            return Err(BrowserError::Timeout(JOB_DEADLINE_EXCEEDED.to_owned()));
        }
        Ok(())
    }

    /// `_bridge_time_left`.
    pub fn time_left(&self, deadline: f64) -> BrowserResult<f64> {
        let remaining = deadline - self.monotonic();
        if remaining <= 0.0 {
            return Err(BrowserError::transient(TIMED_OUT));
        }
        Ok(remaining)
    }

    /// Hold the AppleScript transport for one atomic multi-step transaction.
    pub fn lock_transport(
        &self,
        timeout: f64,
    ) -> BrowserResult<parking_lot::ReentrantMutexGuard<'_, ()>> {
        self.check()?;
        self.applescript
            .try_lock_for(self.bounded(timeout))
            .ok_or_else(|| BrowserError::transient(TIMED_OUT))
    }

    /// A lock wait, never past this thread's job deadline.
    fn bounded(&self, timeout: f64) -> Duration {
        let mut timeout = timeout;
        if let Some(deadline) = job_deadline() {
            timeout = timeout.min(deadline - self.monotonic());
        }
        Duration::from_secs_f64(timeout.max(0.0))
    }

    /// `_run_applescript`: a `secret` script goes on stdin, never argv.
    pub fn run_applescript(
        &self,
        script: &str,
        arguments: &[String],
        timeout_seconds: f64,
        secret: bool,
    ) -> BrowserResult<String> {
        let deadline = self.monotonic() + timeout_seconds;
        let _transport = self.lock_transport(timeout_seconds)?;
        self.check()?;
        let remaining = deadline - self.monotonic();
        if remaining <= 0.0 {
            return Err(BrowserError::transient(TIMED_OUT));
        }
        let mut timeout = remaining.min(control().apple_event_timeout_seconds);
        let mut job_bound = false;
        if let Some(job) = job_deadline() {
            let left = job - self.monotonic();
            if left < timeout {
                timeout = left.max(0.0);
                job_bound = true;
            }
        }
        let (mut argv, stdin) = if secret {
            (vec!["-".to_owned()], Some(script))
        } else {
            (
                vec!["-e".to_owned(), script.to_owned(), "--".to_owned()],
                None,
            )
        };
        argv.extend(arguments.iter().cloned());
        let completed = match self.host.run(OSASCRIPT, &argv, stdin, timeout) {
            Ok(completed) => completed,
            Err(CommandError::NotFound) => {
                return Err(BrowserError::session(
                    "AppleScript is unavailable on this host",
                ));
            }
            Err(CommandError::Timeout) if job_bound => {
                return Err(BrowserError::Timeout(JOB_DEADLINE_EXCEEDED.to_owned()));
            }
            Err(CommandError::Timeout) => return Err(BrowserError::transient(TIMED_OUT)),
            Err(CommandError::Io(kind)) => return Err(BrowserError::other("OSError", kind)),
        };
        if completed.code != 0 {
            return Err(apple_event_failure(&format!(
                "{}\n{}",
                completed.stderr, completed.stdout
            )));
        }
        Ok(completed.stdout)
    }

    /// `_retry_bridge_operation`: retry only explicitly idempotent operations, within budget.
    pub fn retry_operation(
        &self,
        mut operation: impl FnMut(f64) -> BrowserResult<String>,
        timeout_seconds: f64,
    ) -> BrowserResult<String> {
        let deadline = self.monotonic() + timeout_seconds;
        for attempt in 0..control().bridge_retry_limit {
            let remaining = deadline - self.monotonic();
            if remaining <= 0.0 {
                return Err(BrowserError::transient(TIMED_OUT));
            }
            match operation(remaining) {
                Err(error) if error.is(super::super::errors::SessionKind::AutomationTransient) => {
                    let remaining = deadline - self.monotonic();
                    if remaining <= 0.0 || attempt + 1 == control().bridge_retry_limit {
                        return Err(error);
                    }
                    self.sleep(control().poll_interval_seconds.min(remaining))?;
                }
                other => return other,
            }
        }
        unreachable!("Validated bridge retry limit must be positive")
    }

    /// `_read_applescript`: an idempotent native read.
    pub fn read_applescript(
        &self,
        script: &str,
        arguments: &[String],
        timeout_seconds: f64,
    ) -> BrowserResult<String> {
        self.retry_operation(
            |timeout| self.run_applescript(script, arguments, timeout, false),
            timeout_seconds,
        )
    }

    /// `_dispatch_navigation`: pace every native page load, including new worker windows.
    pub fn dispatch_navigation(
        &self,
        script: &str,
        arguments: &[String],
        deadline: f64,
    ) -> BrowserResult<String> {
        self.check()?;
        let mut last = self
            .navigation
            .try_lock_for(self.bounded(self.time_left(deadline)?))
            .ok_or_else(|| BrowserError::transient(TIMED_OUT))?;
        if let Some(previous) = *last {
            loop {
                let wait = previous + control().navigation_interval_seconds - self.monotonic();
                if wait <= 0.0 {
                    break;
                }
                // Page-load pacing never owns the transport while sleeping.
                self.sleep(wait.min(self.time_left(deadline)?))?;
            }
        }
        let _transport = self.lock_transport(self.time_left(deadline)?)?;
        self.time_left(deadline)?;
        // Record dispatch after transport acquisition, including an uncertain send.
        // Native mutations are never replayed here.
        *last = Some(self.monotonic());
        self.run_applescript(script, arguments, self.time_left(deadline)?, false)
    }

    /// `_front_application`: the frontmost app's pid, or reactivate `pid`.
    /// AppKit needs no Apple Events grant.
    pub fn front_application(&self, pid: &str) -> String {
        let mut argv = vec![
            "-l".to_owned(),
            "JavaScript".to_owned(),
            "-e".to_owned(),
            scripts::FRONT_APPLICATION.to_owned(),
            "--".to_owned(),
        ];
        if !pid.is_empty() {
            argv.push(pid.to_owned());
        }
        match self.host.run(
            OSASCRIPT,
            &argv,
            None,
            control().apple_event_timeout_seconds,
        ) {
            Ok(completed) if completed.code == 0 => {
                let result = completed.stdout.trim().to_owned();
                if is_ascii_digits(&result) {
                    result
                } else {
                    String::new()
                }
            }
            _ => String::new(),
        }
    }

    /// `_input_idle_seconds`: seconds since the last keyboard or mouse input.
    pub fn input_idle_seconds(&self) -> f64 {
        let arguments = ["-c", "IOHIDSystem", "-d", "4"].map(str::to_owned);
        let Ok(completed) = self.host.run(
            IOREG,
            &arguments,
            None,
            control().apple_event_timeout_seconds,
        ) else {
            return f64::INFINITY;
        };
        if completed.code != 0 {
            return f64::INFINITY;
        }
        static IDLE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
            Regex::new(r#""HIDIdleTime" = (\d+)"#).expect("valid regex")
        });
        IDLE.captures(&completed.stdout)
            .and_then(|found| found[1].parse::<f64>().ok())
            .map_or(f64::INFINITY, |nanoseconds| nanoseconds / 1e9)
    }

    /// `_close_owned_tab`: close one exact document and prove it is gone everywhere.
    pub fn close_owned_tab(&self, tab_id: &str, window_id: &str) -> BrowserResult<()> {
        let deadline = self.monotonic() + control().interaction_timeout_seconds;
        let arguments = [tab_id.to_owned(), window_id.to_owned()];
        let closed = self.retry_operation(
            |timeout| self.run_applescript(scripts::CLOSE_WORKER_TAB, &arguments, timeout, false),
            control()
                .request_timeout_seconds
                .min(self.time_left(deadline)?),
        )?;
        if closed.trim() != "closed" {
            return Err(BrowserError::session(
                "Owned Instagram tab could not be closed",
            ));
        }
        match self.read_applescript(
            scripts::WORKER_WINDOW,
            &[tab_id.to_owned()],
            control()
                .request_timeout_seconds
                .min(self.time_left(deadline)?),
        ) {
            Err(error) if error.is_session() && error.to_string() == TAB_CLOSED => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Err(BrowserError::session(
                "Owned Instagram tab closure could not be confirmed",
            )),
        }
    }
}

/// Classify a failed `osascript` by what it printed, without exposing the details.
fn apple_event_failure(detail: &str) -> BrowserError {
    // launchd runs the installed binary, so macOS asks once per installed copy.
    const AUTOMATION: &str = "macOS has not allowed wat2do-browser to control Brave Browser: allow it in System Settings > Privacy & Security > Automation (each newly installed worker binary needs this once), then resume the worker";
    let messages: [(&str, &str); 10] = [
        ("Not authorized to send Apple events", AUTOMATION),
        ("(-1743)", AUTOMATION),
        (
            "Executing JavaScript through AppleScript is turned off",
            "Enable Brave View > Developer > Allow JavaScript from Apple Events",
        ),
        (
            "Brave is not running",
            "Open Brave with the logged-in Instagram accounts",
        ),
        (
            "Worker Instagram window did not open",
            "Brave did not open a worker Instagram window",
        ),
        (
            "Pinned Instagram tab changed site",
            "A worker Instagram window left Instagram",
        ),
        ("Pinned Instagram tab is closed", TAB_CLOSED),
        ("Pinned Instagram tab is loading", TAB_LOADING),
        (
            "Worker browser window is closed",
            "A worker Instagram window was closed",
        ),
        (
            "Instagram requires human account recovery",
            "Instagram browser requires human account recovery",
        ),
    ];
    for (needle, message) in messages {
        if detail.contains(needle) {
            // Someone using Brave may close, browse away from or quit the worker's
            // windows; the pool repairs those and waits for Brave.
            return match needle {
                "Pinned Instagram tab is closed"
                | "Pinned Instagram tab changed site"
                | "Worker browser window is closed" => BrowserError::tab_unavailable(message),
                "Brave is not running" | "Worker Instagram window did not open" => {
                    BrowserError::transient(message)
                }
                "Pinned Instagram tab is loading" => BrowserError::page_unavailable(message),
                _ => BrowserError::session(message),
            };
        }
    }
    static CODE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"\((-?\d+)\)").expect("valid regex"));
    let code = CODE.captures(detail).map(|found| found[1].to_owned());
    let suffix = code
        .as_deref()
        .map(|code| format!(" (Apple Event {code})"))
        .unwrap_or_default();
    let message = format!("Brave could not run Instagram browser automation{suffix}");
    if code
        .as_deref()
        .is_some_and(|code| ["-1719", "-1728", "-1712", "-600", "-609"].contains(&code))
    {
        BrowserError::transient(message)
    } else {
        BrowserError::session(message)
    }
}

pub fn is_ascii_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

static STOPPING: AtomicBool = AtomicBool::new(false);

thread_local! {
    static JOB_DEADLINE: Cell<Option<f64>> = const { Cell::new(None) };
    static INTERRUPTIBLE: Cell<bool> = const { Cell::new(false) };
}

fn job_deadline() -> Option<f64> {
    JOB_DEADLINE.with(Cell::get)
}

fn guarded() -> bool {
    job_deadline().is_some() || INTERRUPTIBLE.with(Cell::get)
}

/// A stop request (SIGTERM or Ctrl-C): the worker's main thread stops at its next
/// browser step, as Python raised `KeyboardInterrupt` there.
pub fn request_stop() {
    STOPPING.store(true, Ordering::SeqCst);
}

pub fn stop_requested() -> bool {
    STOPPING.load(Ordering::SeqCst)
}

/// Make this thread (the worker's main thread) stop at its next step once a stop is requested.
pub fn make_interruptible() {
    INTERRUPTIBLE.with(|flag| flag.set(true));
}

/// Python's `job_deadline` context manager: steps on this thread past `seconds` fail
/// with `TimeoutError("Instagram browser job exceeded its deadline")`.
pub fn with_job_deadline<T>(bridge: &Bridge, seconds: f64, operation: impl FnOnce() -> T) -> T {
    let previous = job_deadline();
    JOB_DEADLINE.with(|deadline| deadline.set(Some(bridge.monotonic() + seconds)));
    let result = operation();
    JOB_DEADLINE.with(|deadline| deadline.set(previous));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_map_to_sanitized_classes() {
        let tab = apple_event_failure("execution error: Pinned Instagram tab is closed. (-2700)\n");
        assert!(tab.is(super::super::super::errors::SessionKind::TabUnavailable));
        assert_eq!(tab.to_string(), TAB_CLOSED);
        let transient = apple_event_failure("execution error: Brave got an error: (-1712)\n");
        assert!(transient.is(super::super::super::errors::SessionKind::AutomationTransient));
        assert_eq!(
            transient.to_string(),
            "Brave could not run Instagram browser automation (Apple Event -1712)"
        );
        let other = apple_event_failure("weird\n");
        assert_eq!(
            other.to_string(),
            "Brave could not run Instagram browser automation"
        );
        assert!(other.is(super::super::super::errors::SessionKind::Session));
    }
}
