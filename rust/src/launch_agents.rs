//! Installing local LaunchAgents without losing a previously working service
//! (`core/launch_agents.py`, which the still-Python agents keep using), and the
//! worker binary the Brave LaunchAgents run.
//!
//! The plist is written the way Python's `plistlib.dumps(payload, sort_keys=True)`
//! writes it, and replacing a loaded agent restores the previous one if any step
//! fails.

use std::collections::BTreeMap;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};

use crate::host::{CommandError, Host};

/// launchd starts agents with a bare PATH; this one also finds Claude Code
/// (`~/.local/bin`) and Homebrew tools.
pub fn claude_code_path() -> String {
    format!(
        "{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        home().join(".local/bin").display()
    )
}

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// `~/Library/LaunchAgents/<label>.plist`.
pub fn agent_path(label: &str) -> PathBuf {
    home()
        .join("Library/LaunchAgents")
        .join(format!("{label}.plist"))
}

/// The repository checkout this binary was built from.
pub fn repository_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the crate lives in the repository")
        .to_path_buf()
}

/// Where `wat2do-browser install` keeps the worker binary the LaunchAgents run.
///
/// launchd runs this exact file, so macOS's Automation approval for Brave belongs to it.
/// It is replaced only when its source fingerprint changes (each new copy needs one
/// approval again); rebuilding the checkout for anything else leaves it, and the
/// approval, alone.
pub fn installed_binary_path() -> PathBuf {
    home().join(".local/libexec/wat2do/wat2do-browser")
}

/// A worker binary put in place by [`install_binary`], which can be undone until it is
/// kept.
#[derive(Debug)]
pub struct BinaryInstall {
    pub destination: PathBuf,
    pub replaced: bool,
    /// The copy it replaced, kept aside until the install is confirmed.
    previous: Option<PathBuf>,
}

impl BinaryInstall {
    /// Keep the new binary and drop the one it replaced.
    pub fn keep(self) {
        if let Some(previous) = &self.previous {
            let _ = std::fs::remove_file(previous);
        }
    }

    /// Put the replaced binary back (or remove a first install).
    pub fn restore(self) -> std::io::Result<()> {
        if !self.replaced {
            return Ok(());
        }
        match &self.previous {
            Some(previous) => std::fs::rename(previous, &self.destination),
            None => std::fs::remove_file(&self.destination),
        }
    }
}

/// Copy `source` to `destination` unless the binary there already reports
/// `fingerprint`; a replaced copy is kept aside until [`BinaryInstall::keep`].
pub fn install_binary(
    host: &dyn Host,
    source: &Path,
    destination: &Path,
    fingerprint: &str,
) -> std::io::Result<BinaryInstall> {
    let unchanged = BinaryInstall {
        destination: destination.to_path_buf(),
        replaced: false,
        previous: None,
    };
    if destination.exists()
        && let Ok(installed) = host.run(
            &destination.display().to_string(),
            &["source-fingerprint".to_owned()],
            None,
            10.0,
        )
        && installed.code == 0
        && installed.stdout.trim() == fingerprint
    {
        return Ok(unchanged);
    }
    let parent = destination.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let partial = destination.with_extension("partial");
    std::fs::copy(source, &partial)?;
    std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755))?;
    let previous = if destination.exists() {
        let previous = destination.with_extension("previous");
        std::fs::rename(destination, &previous)?;
        Some(previous)
    } else {
        None
    };
    if let Err(error) = std::fs::rename(&partial, destination) {
        if let Some(previous) = &previous {
            let _ = std::fs::rename(previous, destination);
        }
        return Err(error);
    }
    Ok(BinaryInstall {
        replaced: true,
        previous,
        ..unchanged
    })
}

/// A property list value.
#[derive(Debug, Clone, PartialEq)]
pub enum Plist {
    String(String),
    Integer(i64),
    Bool(bool),
    Array(Vec<Plist>),
    /// Keys are written sorted, like `sort_keys=True`.
    Dict(BTreeMap<String, Plist>),
}

impl From<&str> for Plist {
    fn from(value: &str) -> Self {
        Plist::String(value.to_owned())
    }
}

impl From<String> for Plist {
    fn from(value: String) -> Self {
        Plist::String(value)
    }
}

/// The XML `plistlib.dumps(payload, sort_keys=True)` produces.
pub fn to_xml(payload: &Plist) -> Result<String> {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n",
    );
    write_value(payload, 0, &mut out)?;
    out.push_str("</plist>\n");
    Ok(out)
}

fn escape(text: &str) -> Result<String> {
    if text
        .chars()
        .any(|c| matches!(c, '\0'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}'))
    {
        bail!("strings can't contain control characters");
    }
    Ok(text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;"))
}

fn write_value(value: &Plist, depth: usize, out: &mut String) -> Result<()> {
    let indent = "\t".repeat(depth);
    match value {
        Plist::String(text) => {
            out.push_str(&format!("{indent}<string>{}</string>\n", escape(text)?))
        }
        Plist::Integer(number) => out.push_str(&format!("{indent}<integer>{number}</integer>\n")),
        Plist::Bool(true) => out.push_str(&format!("{indent}<true/>\n")),
        Plist::Bool(false) => out.push_str(&format!("{indent}<false/>\n")),
        Plist::Array(items) if items.is_empty() => out.push_str(&format!("{indent}<array/>\n")),
        Plist::Array(items) => {
            out.push_str(&format!("{indent}<array>\n"));
            for item in items {
                write_value(item, depth + 1, out)?;
            }
            out.push_str(&format!("{indent}</array>\n"));
        }
        Plist::Dict(entries) if entries.is_empty() => out.push_str(&format!("{indent}<dict/>\n")),
        Plist::Dict(entries) => {
            out.push_str(&format!("{indent}<dict>\n"));
            for (key, item) in entries {
                out.push_str(&format!("{indent}\t<key>{}</key>\n", escape(key)?));
                write_value(item, depth + 1, out)?;
            }
            out.push_str(&format!("{indent}</dict>\n"));
        }
    }
    Ok(())
}

/// Runs `launchctl` through a [`Host`]; tests point it at a stand-in.
pub struct Launchctl {
    pub host: Arc<dyn Host>,
    pub program: String,
    pub timeout: Duration,
    pub poll_interval: Duration,
    /// Set by SIGINT or SIGTERM once [`Launchctl::stop_on_signals`] is called. A
    /// replacement in progress then puts the previous agent back before stopping, as
    /// Python did on KeyboardInterrupt.
    pub interrupted: Arc<AtomicBool>,
}

impl Launchctl {
    /// The system's `launchctl`, run through `host`.
    pub fn new(host: Arc<dyn Host>, timeout: Duration, poll_interval: Duration) -> Self {
        Self {
            host,
            program: "launchctl".to_owned(),
            timeout,
            poll_interval,
            interrupted: Arc::default(),
        }
    }

    /// SIGINT and SIGTERM no longer end the process; they set `interrupted`, which the
    /// install steps check.
    pub fn stop_on_signals(self) -> Result<Self> {
        for signal in [signal_hook::consts::SIGINT, signal_hook::consts::SIGTERM] {
            signal_hook::flag::register(signal, Arc::clone(&self.interrupted))?;
        }
        Ok(self)
    }

    /// Fails once an interrupt has arrived.
    pub fn check_interrupted(&self) -> Result<()> {
        if self.interrupted.load(Ordering::SeqCst) {
            bail!("LaunchAgent install interrupted");
        }
        Ok(())
    }

    /// Whether `launchctl <arguments>` succeeded; with `check`, a failure is an error.
    /// Its output is never shown.
    fn run(&self, arguments: &[&str], timeout: f64, check: bool) -> Result<bool> {
        let command = arguments[0];
        let arguments: Vec<String> = arguments
            .iter()
            .map(|&argument| argument.to_owned())
            .collect();
        let output = self
            .host
            .run(&self.program, &arguments, None, timeout)
            .map_err(|error| {
                // Python's exception names, as `core/launch_agents.py` reports them.
                let kind = match error {
                    CommandError::Timeout => "TimeoutExpired",
                    CommandError::NotFound => "FileNotFoundError",
                    CommandError::Io(_) => "OSError",
                };
                anyhow!("LaunchAgent {command} failed ({kind})")
            })?;
        if check && output.code != 0 {
            bail!("LaunchAgent {command} failed (exit {})", output.code);
        }
        Ok(output.code == 0)
    }

    /// Launchd may retain the stopped service entry after bootout returns.
    fn wait_for_unload(&self, service: &str) -> Result<()> {
        let deadline = self.host.monotonic() + self.timeout.as_secs_f64();
        loop {
            let remaining = deadline - self.host.monotonic();
            if remaining <= 0.0 {
                bail!("LaunchAgent unload timed out; service is still registered");
            }
            if !self.run(&["print", service], remaining, false)? {
                return Ok(());
            }
            let remaining = deadline - self.host.monotonic();
            if remaining > 0.0 {
                self.host
                    .sleep(self.poll_interval.as_secs_f64().min(remaining));
            }
        }
    }
}

/// A replacement failed and the previous agent may not be running again
/// (Python's `LaunchAgentRecoveryError`).
#[derive(Debug)]
pub struct RecoveryUncertain(pub String);

impl std::fmt::Display for RecoveryUncertain {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for RecoveryUncertain {}

/// A private, flushed copy of `payload` beside `path`.
fn stage(path: &Path, payload: &[u8]) -> std::io::Result<tempfile::NamedTempFile> {
    let parent = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut temporary = tempfile::Builder::new()
        .prefix(&format!(".{name}."))
        .suffix(".tmp")
        .tempfile_in(parent)?;
    temporary.write_all(payload)?;
    temporary.as_file().sync_all()?;
    Ok(temporary)
}

/// Flush a private replacement before touching the existing durable file.
pub fn atomic_write(path: &Path, payload: &[u8]) -> std::io::Result<()> {
    stage(path, payload)?
        .persist(path)
        .map_err(|error| error.error)?;
    Ok(())
}

/// Validate storage first and restore the previous agent if replacement fails.
pub fn install_launch_agent(
    path: &Path,
    label: &str,
    payload: &Plist,
    launchctl: &Launchctl,
) -> Result<()> {
    // SAFETY: getuid has no preconditions and cannot fail.
    let domain = format!("gui/{}", unsafe { libc::getuid() });
    let service = format!("{domain}/{label}");
    let timeout = launchctl.timeout.as_secs_f64();
    // Only a missing plist means there is nothing to restore; any other read
    // error stops before anything changes.
    let previous = match std::fs::read(path) {
        Ok(previous) => Some(previous),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).context("could not read the current LaunchAgent"),
    };
    let loaded = launchctl.run(&["print", &service], timeout, false)?;
    // Stage all writes while the previous service is still available.
    let mut candidate = Some(stage(path, to_xml(payload)?.as_bytes())?);
    let mut stop_attempted = false;
    let mut replaced = false;
    let attempt = (|| -> Result<()> {
        launchctl.run(&["enable", &service], timeout, true)?;
        launchctl.check_interrupted()?;
        if loaded {
            stop_attempted = true;
            launchctl.run(&["bootout", &service], timeout, true)?;
            launchctl.wait_for_unload(&service)?;
            launchctl.check_interrupted()?;
        }
        if let Some(staged) = candidate.take() {
            staged.persist(path)?;
        }
        replaced = true;
        launchctl.check_interrupted()?;
        launchctl.run(
            &["bootstrap", &domain, &path.to_string_lossy()],
            timeout,
            true,
        )?;
        Ok(())
    })();
    // A staged copy that never replaced the plist is deleted here.
    drop(candidate);
    let Err(error) = attempt else {
        return Ok(());
    };
    let mut recovery: Result<()> = (|| {
        if replaced {
            launchctl.run(&["bootout", &service], timeout, false)?;
            launchctl.wait_for_unload(&service)?;
        } else if stop_attempted {
            launchctl.wait_for_unload(&service)?;
        }
        Ok(())
    })();
    let recovered_cleanly = recovery.is_ok();
    let restore: Result<()> = (|| {
        // Preserve the old configuration even when launchd cannot settle.
        if replaced {
            match &previous {
                None => {
                    let _ = std::fs::remove_file(path);
                }
                Some(previous) => atomic_write(path, previous)?,
            }
        }
        if stop_attempted && recovered_cleanly {
            launchctl.run(
                &["bootstrap", &domain, &path.to_string_lossy()],
                timeout,
                true,
            )?;
        }
        Ok(())
    })();
    if let Err(restore) = restore {
        recovery = Err(restore);
    }
    if recovery.is_err() {
        return Err(RecoveryUncertain(format!(
            "LaunchAgent replacement failed; previous service recovery remains uncertain ({error})"
        ))
        .into());
    }
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::CommandOutput;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn payload() -> Plist {
        Plist::Dict(BTreeMap::from([
            ("Label".to_owned(), "io.wat2do.test".into()),
            (
                "ProgramArguments".to_owned(),
                Plist::Array(vec!["/bin/echo".into(), "a & <b>".into()]),
            ),
            ("RunAtLoad".to_owned(), Plist::Bool(true)),
            ("StartInterval".to_owned(), Plist::Integer(60)),
            (
                "EnvironmentVariables".to_owned(),
                Plist::Dict(BTreeMap::from([("PATH".to_owned(), "/usr/bin".into())])),
            ),
            ("Empty".to_owned(), Plist::Array(vec![])),
        ]))
    }

    #[test]
    fn plists_are_written_like_plistlib() {
        // The expected bytes are plistlib.dumps(payload, sort_keys=True) from Python 3.12.
        assert_eq!(
            to_xml(&payload()).unwrap(),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\">\n\
             <dict>\n\
             \t<key>Empty</key>\n\
             \t<array/>\n\
             \t<key>EnvironmentVariables</key>\n\
             \t<dict>\n\
             \t\t<key>PATH</key>\n\
             \t\t<string>/usr/bin</string>\n\
             \t</dict>\n\
             \t<key>Label</key>\n\
             \t<string>io.wat2do.test</string>\n\
             \t<key>ProgramArguments</key>\n\
             \t<array>\n\
             \t\t<string>/bin/echo</string>\n\
             \t\t<string>a &amp; &lt;b&gt;</string>\n\
             \t</array>\n\
             \t<key>RunAtLoad</key>\n\
             \t<true/>\n\
             \t<key>StartInterval</key>\n\
             \t<integer>60</integer>\n\
             </dict>\n\
             </plist>\n"
        );
        assert!(to_xml(&Plist::String("bell\u{7}".into())).is_err());
    }

    /// A stand-in launchd on a virtual clock. It logs each `launchctl` call, fails the
    /// first `count` calls of each command in `fail`, keeps a stopped service listed for
    /// `linger` more prints, as launchd sometimes does, and keeps the plist each
    /// bootstrap starts.
    #[derive(Default)]
    struct Launchd(Mutex<LaunchdState>);

    #[derive(Default)]
    struct LaunchdState {
        loaded: bool,
        failures: HashMap<String, u32>,
        linger_after_bootout: u32,
        linger: u32,
        calls: Vec<String>,
        started: Vec<String>,
        clock: f64,
        /// Every call runs past its timeout.
        stalled: bool,
        /// Set the moment `bootout` runs, as SIGINT would.
        interrupt_on_bootout: Option<Arc<AtomicBool>>,
    }

    impl Host for Launchd {
        fn run(
            &self,
            program: &str,
            args: &[String],
            _stdin: Option<&str>,
            timeout: f64,
        ) -> Result<CommandOutput, CommandError> {
            assert_eq!(program, "launchctl");
            let mut state = self.0.lock().unwrap();
            let command = args[0].clone();
            state.calls.push(command.clone());
            if state.stalled {
                state.clock += timeout;
                return Err(CommandError::Timeout);
            }
            state.clock += 0.001;
            let code = match state.failures.get_mut(&command) {
                Some(left) if *left > 0 => {
                    *left -= 1;
                    5
                }
                _ => match command.as_str() {
                    "print" if state.linger > 0 => {
                        state.linger -= 1;
                        0
                    }
                    "print" => {
                        if state.loaded {
                            0
                        } else {
                            113
                        }
                    }
                    "bootout" => {
                        state.loaded = false;
                        state.linger = state.linger_after_bootout;
                        if let Some(interrupted) = &state.interrupt_on_bootout {
                            interrupted.store(true, Ordering::SeqCst);
                        }
                        0
                    }
                    "bootstrap" => {
                        state.loaded = true;
                        let plist = std::fs::read_to_string(&args[2]).unwrap();
                        state.started.push(plist);
                        0
                    }
                    _ => 0,
                },
            };
            Ok(CommandOutput {
                code,
                stdout: String::new(),
                stderr: String::new(),
            })
        }

        fn monotonic(&self) -> f64 {
            self.0.lock().unwrap().clock
        }

        fn time(&self) -> f64 {
            self.monotonic()
        }

        fn sleep(&self, seconds: f64) {
            self.0.lock().unwrap().clock += seconds;
        }
    }

    impl Launchd {
        fn calls(&self) -> Vec<String> {
            self.0.lock().unwrap().calls.clone()
        }

        /// The plists launchd was asked to start, in order.
        fn started(&self) -> Vec<String> {
            self.0.lock().unwrap().started.clone()
        }
    }

    fn fake_launchctl(
        loaded: bool,
        fail: &[(&str, u32)],
        linger: u32,
    ) -> (Arc<Launchd>, Launchctl) {
        let launchd = Arc::new(Launchd(Mutex::new(LaunchdState {
            loaded,
            failures: fail
                .iter()
                .map(|(command, count)| ((*command).to_owned(), *count))
                .collect(),
            linger_after_bootout: linger,
            ..LaunchdState::default()
        })));
        let launchctl = Launchctl::new(
            launchd.clone(),
            Duration::from_secs(3),
            Duration::from_millis(10),
        );
        (launchd, launchctl)
    }

    fn with_previous(folder: &Path) -> PathBuf {
        let path = folder.join("agents/io.wat2do.test.plist");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old").unwrap();
        path
    }

    #[test]
    fn a_first_install_writes_a_private_plist_without_stopping_anything() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("agents/io.wat2do.test.plist");
        let (launchd, launchctl) = fake_launchctl(false, &[], 0);

        install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            to_xml(&payload()).unwrap()
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(launchd.calls(), ["print", "enable", "bootstrap"]);
    }

    #[test]
    fn a_replacement_waits_for_the_previous_service_to_disappear() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let (launchd, launchctl) = fake_launchctl(true, &[], 2);

        install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap();

        assert_eq!(
            launchd.calls(),
            [
                "print",
                "enable",
                "bootout",
                "print",
                "print",
                "print",
                "bootstrap"
            ]
        );
        assert_eq!(launchd.started(), [to_xml(&payload()).unwrap()]);
        // No staged copy is left beside the plist.
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }

    #[test]
    fn a_failed_bootstrap_waits_for_its_late_entry_then_restores_the_old_service() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let (launchd, launchctl) = fake_launchctl(true, &[("bootstrap", 1)], 1);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "LaunchAgent bootstrap failed (exit 5)");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert_eq!(
            launchd.calls(),
            [
                "print",
                "enable",
                "bootout",
                "print",
                "print",
                "bootstrap",
                "bootout",
                "print",
                "print",
                "bootstrap"
            ]
        );
        assert_eq!(launchd.started(), ["old"]);
    }

    #[test]
    fn an_unsettled_failed_replacement_still_restores_the_previous_plist() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let (_, launchctl) = fake_launchctl(true, &[("bootstrap", 9)], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        // The old plist is back; its reload failed too, so recovery is uncertain.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert!(
            error.to_string().contains("recovery remains uncertain"),
            "{error}"
        );
        assert!(error.downcast_ref::<RecoveryUncertain>().is_some());
    }

    #[test]
    fn a_failed_stop_keeps_the_previous_agent_intact() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        // The stop never settles, so the wait runs out.
        let (launchd, launchctl) = fake_launchctl(true, &[("bootout", 9)], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert!(
            error.to_string().contains("recovery remains uncertain"),
            "{error}"
        );
        assert!(error.downcast_ref::<RecoveryUncertain>().is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert!(!launchd.calls().contains(&"bootstrap".to_owned()));
    }

    #[test]
    fn a_failed_enable_leaves_a_new_agent_uninstalled() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("io.wat2do.test.plist");
        let (launchd, launchctl) = fake_launchctl(false, &[("enable", 1)], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "LaunchAgent enable failed (exit 5)");
        assert!(!path.exists());
        assert_eq!(launchd.calls(), ["print", "enable"]);
        assert_eq!(
            std::fs::read_dir(folder.path())
                .unwrap()
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
    }

    #[test]
    fn a_stalled_launchctl_times_out_without_its_output() {
        let folder = tempfile::tempdir().unwrap();
        let (launchd, launchctl) = fake_launchctl(false, &[], 0);
        launchd.0.lock().unwrap().stalled = true;

        let error = install_launch_agent(
            &folder.path().join("a.plist"),
            "io.wat2do.test",
            &payload(),
            &launchctl,
        )
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "LaunchAgent print failed (TimeoutExpired)"
        );
    }

    #[test]
    fn an_interrupted_replacement_restores_the_old_agent_before_stopping() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        // The interrupt lands while the stopped service is still listed.
        let (launchd, launchctl) = fake_launchctl(true, &[], 2);
        launchd.0.lock().unwrap().interrupt_on_bootout = Some(Arc::clone(&launchctl.interrupted));

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "LaunchAgent install interrupted");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert_eq!(launchd.started(), ["old"]);
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }

    #[test]
    fn an_unreadable_previous_plist_stops_before_anything_changes() {
        let folder = tempfile::tempdir().unwrap();
        // A directory where the plist should be cannot be read as a file.
        let path = folder.path().join("io.wat2do.test.plist");
        std::fs::create_dir(&path).unwrap();
        let (launchd, launchctl) = fake_launchctl(true, &[], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "could not read the current LaunchAgent");
        assert!(launchd.calls().is_empty());
        assert!(path.is_dir());
    }
}
