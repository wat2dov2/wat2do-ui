//! The operating system as the Mac services see it: subprocesses and clocks.
//!
//! Everything that drives Brave, the Keychain or `gh` goes through [`Host`], so
//! tests replace the machine with a scripted fake and never touch a real app.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// What a finished subprocess printed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    /// The program does not exist (Python's `FileNotFoundError`).
    NotFound,
    /// It ran past its timeout and was killed (`subprocess.TimeoutExpired`).
    Timeout,
    /// Any other `OSError`.
    Io(String),
}

pub trait Host: Send + Sync {
    /// Run `program` with `args`, writing `stdin` when given, killed after `timeout` seconds.
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&str>,
        timeout: f64,
    ) -> Result<CommandOutput, CommandError>;
    /// `time.monotonic()`.
    fn monotonic(&self) -> f64;
    /// `time.time()`.
    fn time(&self) -> f64;
    /// `time.sleep(seconds)`.
    fn sleep(&self, seconds: f64);
}

/// The real Mac.
pub struct RealHost {
    started: Instant,
}

impl Default for RealHost {
    fn default() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl RealHost {
    pub fn shared() -> Arc<dyn Host> {
        Arc::new(Self::default())
    }
}

impl Host for RealHost {
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&str>,
        timeout: f64,
    ) -> Result<CommandOutput, CommandError> {
        run_command(program, args, stdin, timeout)
    }

    fn monotonic(&self) -> f64 {
        // Offset so a fresh process never reports zero, like a real monotonic clock.
        1_000.0 + self.started.elapsed().as_secs_f64()
    }

    fn time(&self) -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs_f64())
            .unwrap_or(0.0)
    }

    fn sleep(&self, seconds: f64) {
        if seconds > 0.0 && seconds.is_finite() {
            std::thread::sleep(Duration::from_secs_f64(seconds));
        }
    }
}

/// `subprocess.run(..., capture_output=True, text=True, timeout=timeout)`.
pub fn run_command(
    program: &str,
    args: &[String],
    stdin: Option<&str>,
    timeout: f64,
) -> Result<CommandOutput, CommandError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => CommandError::NotFound,
        _ => CommandError::Io(error.kind().to_string()),
    })?;
    if let Some(input) = stdin {
        let mut pipe = child.stdin.take().expect("stdin is piped");
        let input = input.to_owned();
        // A large script must not block on a full pipe before the child reads it.
        std::thread::spawn(move || {
            let _ = pipe.write_all(input.as_bytes());
        });
    }
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });
    let deadline = Instant::now() + Duration::from_secs_f64(timeout.max(0.0));
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(CommandError::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(2)),
            Err(error) => return Err(CommandError::Io(error.kind().to_string())),
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok(CommandOutput {
        code: status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// Python's `threading.Event`.
#[derive(Default)]
pub struct Event {
    flag: Mutex<bool>,
    changed: Condvar,
}

impl Event {
    pub fn set(&self) {
        *self
            .flag
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = true;
        self.changed.notify_all();
    }

    pub fn clear(&self) {
        *self
            .flag
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = false;
    }

    pub fn is_set(&self) -> bool {
        *self
            .flag
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Wait until set or `timeout` seconds pass; whether it is set.
    pub fn wait(&self, timeout: f64) -> bool {
        let flag = self
            .flag
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let (flag, _) = self
            .changed
            .wait_timeout_while(flag, Duration::from_secs_f64(timeout.max(0.0)), |set| !*set)
            .unwrap_or_else(|poison| poison.into_inner());
        *flag
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_report_output_missing_programs_and_timeouts() {
        let output = run_command(
            "/bin/sh",
            &["-c".into(), "cat; echo err >&2; exit 3".into()],
            Some("hi"),
            5.0,
        )
        .expect("sh runs");
        assert_eq!(
            output,
            CommandOutput {
                code: 3,
                stdout: "hi".into(),
                stderr: "err\n".into()
            }
        );
        assert_eq!(
            run_command("/nonexistent/program", &[], None, 1.0),
            Err(CommandError::NotFound)
        );
        assert_eq!(
            run_command("/bin/sh", &["-c".into(), "sleep 5".into()], None, 0.1),
            Err(CommandError::Timeout)
        );
    }

    #[test]
    fn event_wakes_waiters() {
        let event = Arc::new(Event::default());
        assert!(!event.wait(0.01));
        let setter = event.clone();
        std::thread::spawn(move || setter.set());
        assert!(event.wait(5.0));
        event.clear();
        assert!(!event.is_set());
    }
}
