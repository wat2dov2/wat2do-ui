//! Installing local LaunchAgents without losing a previously working service
//! (`core/launch_agents.py`).
//!
//! The plist is written the way Python's `plistlib.dumps(payload, sort_keys=True)`
//! writes it, and replacing a loaded agent restores the previous one if any step
//! fails.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};

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

/// Runs `launchctl`; tests point it at a stand-in.
pub struct Launchctl {
    pub program: PathBuf,
    pub timeout: Duration,
    pub poll_interval: Duration,
    /// Set by SIGINT or SIGTERM. A replacement in progress then puts the
    /// previous agent back before stopping, as Python did on KeyboardInterrupt.
    pub interrupted: Arc<AtomicBool>,
}

impl Launchctl {
    /// The real launchctl. SIGINT and SIGTERM no longer end the process; they
    /// set `interrupted`, which the install steps check.
    pub fn new(timeout: Duration, poll_interval: Duration) -> Result<Self> {
        let interrupted = Arc::new(AtomicBool::new(false));
        for signal in [signal_hook::consts::SIGINT, signal_hook::consts::SIGTERM] {
            signal_hook::flag::register(signal, Arc::clone(&interrupted))?;
        }
        Ok(Self {
            program: PathBuf::from("launchctl"),
            timeout,
            poll_interval,
            interrupted,
        })
    }

    /// Fails once an interrupt has arrived.
    pub fn check_interrupted(&self) -> Result<()> {
        if self.interrupted.load(Ordering::SeqCst) {
            bail!("LaunchAgent install interrupted");
        }
        Ok(())
    }

    fn run(&self, arguments: &[&str], timeout: Duration, check: bool) -> Result<bool> {
        let command = arguments[0];
        let mut child = std::process::Command::new(&self.program)
            .args(arguments)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|error| anyhow!("LaunchAgent {command} failed ({:?})", error.kind()))?;
        let deadline = Instant::now() + timeout;
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                bail!("LaunchAgent {command} failed (TimeoutExpired)");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        if check && !status.success() {
            bail!(
                "LaunchAgent {command} failed (exit {})",
                status.code().unwrap_or(-1)
            );
        }
        Ok(status.success())
    }

    /// Launchd may retain the stopped service entry after bootout returns.
    fn wait_for_unload(&self, service: &str) -> Result<()> {
        let deadline = Instant::now() + self.timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                bail!("LaunchAgent unload timed out; service is still registered");
            }
            if !self.run(&["print", service], remaining, false)? {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if !remaining.is_zero() {
                std::thread::sleep(self.poll_interval.min(remaining));
            }
        }
    }
}

/// A private, flushed copy of `payload` beside `path`.
fn stage(path: &Path, payload: &[u8]) -> Result<tempfile::NamedTempFile> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("no parent directory"))?;
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

fn atomic_write(path: &Path, payload: &[u8]) -> Result<()> {
    stage(path, payload)?.persist(path)?;
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
    let uid = unsafe { libc_getuid() };
    let domain = format!("gui/{uid}");
    let service = format!("{domain}/{label}");
    let timeout = launchctl.timeout;
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
        bail!(
            "LaunchAgent replacement failed; previous service recovery remains uncertain ({error})"
        );
    }
    Err(error)
}

unsafe extern "C" {
    #[link_name = "getuid"]
    fn libc_getuid() -> u32;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

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

    /// A stand-in launchctl. It logs each call, fails the first `count` calls of
    /// each command in `fail`, and keeps a stopped service listed for `linger`
    /// more prints, as launchd sometimes does.
    fn fake_launchctl(folder: &Path, loaded: bool, fail: &[(&str, u32)], linger: u32) -> Launchctl {
        let script = folder.join("launchctl");
        let state = folder.join("loaded");
        if loaded {
            std::fs::write(&state, "").unwrap();
        }
        let failures: String = fail
            .iter()
            .map(|(command, count)| format!("{command}) limit={count};; "))
            .collect();
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\n\
                 cd '{folder}'\n\
                 echo \"$1\" >> calls.log\n\
                 limit=0\n\
                 case \"$1\" in {failures}*) ;; esac\n\
                 count=$(cat \"failed-$1\" 2>/dev/null || echo 0)\n\
                 if [ \"$count\" -lt \"$limit\" ]; then echo $((count + 1)) > \"failed-$1\"; exit 5; fi\n\
                 case \"$1\" in\n\
                 print)\n\
                   left=$(cat linger 2>/dev/null || echo 0)\n\
                   if [ \"$left\" -gt 0 ]; then echo $((left - 1)) > linger; exit 0; fi\n\
                   test -e '{state}';;\n\
                 bootout) rm -f '{state}'; echo {linger} > linger;;\n\
                 bootstrap) touch '{state}'; cp \"$3\" \"started-$(ls started-* 2>/dev/null | wc -l | tr -d ' ')\";;\n\
                 esac\n",
                folder = folder.display(),
                state = state.display(),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        Launchctl {
            program: script,
            timeout: Duration::from_secs(3),
            poll_interval: Duration::from_millis(10),
            interrupted: Arc::default(),
        }
    }

    fn calls(folder: &Path) -> Vec<String> {
        std::fs::read_to_string(folder.join("calls.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// The plists launchd was asked to start, in order.
    fn started(folder: &Path) -> Vec<String> {
        (0..)
            .map_while(|index| {
                std::fs::read_to_string(folder.join(format!("started-{index}"))).ok()
            })
            .collect()
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
        let launchctl = fake_launchctl(folder.path(), false, &[], 0);

        install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            to_xml(&payload()).unwrap()
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(calls(folder.path()), ["print", "enable", "bootstrap"]);
    }

    #[test]
    fn a_replacement_waits_for_the_previous_service_to_disappear() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let launchctl = fake_launchctl(folder.path(), true, &[], 2);

        install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap();

        assert_eq!(
            calls(folder.path()),
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
        assert_eq!(started(folder.path()), [to_xml(&payload()).unwrap()]);
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
        let launchctl = fake_launchctl(folder.path(), true, &[("bootstrap", 1)], 1);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "LaunchAgent bootstrap failed (exit 5)");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert_eq!(
            calls(folder.path()),
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
        assert_eq!(started(folder.path()), ["old"]);
    }

    #[test]
    fn an_unsettled_failed_replacement_still_restores_the_previous_plist() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let launchctl = fake_launchctl(folder.path(), true, &[("bootstrap", 9)], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        // The old plist is back; its reload failed too, so recovery is uncertain.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert!(
            error.to_string().contains("recovery remains uncertain"),
            "{error}"
        );
    }

    #[test]
    fn a_failed_stop_keeps_the_previous_agent_intact() {
        let folder = tempfile::tempdir().unwrap();
        let path = with_previous(folder.path());
        let mut launchctl = fake_launchctl(folder.path(), true, &[("bootout", 9)], 0);
        // Short enough to keep the test quick; the stop never settles, so the wait runs out.
        launchctl.timeout = Duration::from_secs(1);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert!(
            error.to_string().contains("recovery remains uncertain"),
            "{error}"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert!(!calls(folder.path()).contains(&"bootstrap".to_owned()));
    }

    #[test]
    fn a_failed_enable_leaves_a_new_agent_uninstalled() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("io.wat2do.test.plist");
        let launchctl = fake_launchctl(folder.path(), false, &[("enable", 1)], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "LaunchAgent enable failed (exit 5)");
        assert!(!path.exists());
        assert_eq!(calls(folder.path()), ["print", "enable"]);
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
        let script = folder.path().join("launchctl");
        std::fs::write(&script, "#!/bin/sh\necho private token\nsleep 5\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let launchctl = Launchctl {
            program: script,
            timeout: Duration::from_millis(200),
            poll_interval: Duration::from_millis(10),
            interrupted: Arc::default(),
        };

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
        // The stopped service lingers long enough for the interrupt to land mid-replacement.
        let launchctl = fake_launchctl(folder.path(), true, &[], 40);
        let interrupted = Arc::clone(&launchctl.interrupted);
        let log = folder.path().join("calls.log");
        let watcher = std::thread::spawn(move || {
            for _ in 0..2000 {
                if std::fs::read_to_string(&log)
                    .unwrap_or_default()
                    .contains("bootout")
                {
                    interrupted.store(true, Ordering::SeqCst);
                    return;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        });

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();
        watcher.join().unwrap();

        assert_eq!(error.to_string(), "LaunchAgent install interrupted");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert_eq!(started(folder.path()), ["old"]);
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
        let launchctl = fake_launchctl(folder.path(), true, &[], 0);

        let error =
            install_launch_agent(&path, "io.wat2do.test", &payload(), &launchctl).unwrap_err();

        assert_eq!(error.to_string(), "could not read the current LaunchAgent");
        assert!(calls(folder.path()).is_empty());
        assert!(path.is_dir());
    }
}
