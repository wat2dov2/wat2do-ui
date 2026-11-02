//! The ingestion LaunchAgents: the always-on processor and the directory scrape
//! every `directory_scrape_interval_seconds`.
//!
//! Both run `cargo run --release` against the checkout this binary was built
//! from, so a moved runtime checkout runs its own code and prompts after a
//! kickstart. Each keeps a log under the ingestion state directory.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;

use super::state_directory;
use crate::controlbox::INGESTION;
use crate::launch_agents::{Launchctl, Plist, claude_code_path, home, install_launch_agent};

/// One scheduled `wat2do-ingest` subcommand.
pub struct Job {
    pub command: &'static str,
    pub label: &'static str,
    /// Seconds between runs; `None` keeps the job always running.
    pub interval: Option<u64>,
    pub stdout: &'static str,
    pub stderr: &'static str,
}

pub fn jobs() -> [Job; 2] {
    [
        Job {
            command: "process",
            label: "io.wat2do.ingestion.process",
            interval: None,
            // The processor prints its totals only when it stops.
            stdout: "/dev/null",
            stderr: "process.stderr.log",
        },
        Job {
            command: "scrape-directories",
            label: "io.wat2do.ingestion.directories",
            interval: Some(INGESTION.directory_scrape_interval_seconds),
            // One line of totals per run, with the warnings of the sources that failed.
            stdout: "directories.log",
            stderr: "directories.log",
        },
    ]
}

/// The checkout this binary was built from.
pub fn repository_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the crate lives in the repository")
        .to_path_buf()
}

fn log_path(name: &str) -> String {
    if name.starts_with('/') {
        name.to_owned()
    } else {
        state_directory().join(name).to_string_lossy().into_owned()
    }
}

pub fn launch_agent_payload(job: &Job) -> Plist {
    let repository = repository_directory();
    let cargo = home().join(".cargo/bin/cargo");
    let manifest = repository.join("rust/Cargo.toml");
    let arguments = [
        cargo.to_string_lossy().as_ref(),
        "run",
        "--release",
        "--quiet",
        "--manifest-path",
        manifest.to_string_lossy().as_ref(),
        "--bin",
        "wat2do-ingest",
        "--",
        job.command,
    ]
    .map(Plist::from);
    let path = format!(
        "{}:{}",
        cargo.parent().expect("cargo is in a folder").display(),
        claude_code_path()
    );
    let mut payload = BTreeMap::from([
        ("Label".to_owned(), job.label.into()),
        (
            "ProgramArguments".to_owned(),
            Plist::Array(arguments.to_vec()),
        ),
        (
            // backend/.env is read from the working directory.
            "WorkingDirectory".to_owned(),
            repository
                .join("backend")
                .to_string_lossy()
                .into_owned()
                .into(),
        ),
        (
            "EnvironmentVariables".to_owned(),
            Plist::Dict(BTreeMap::from([("PATH".to_owned(), path.into())])),
        ),
        ("RunAtLoad".to_owned(), Plist::Bool(true)),
        ("ProcessType".to_owned(), "Background".into()),
        ("StandardOutPath".to_owned(), log_path(job.stdout).into()),
        ("StandardErrorPath".to_owned(), log_path(job.stderr).into()),
    ]);
    match job.interval {
        Some(seconds) => payload.insert("StartInterval".to_owned(), Plist::Integer(seconds as i64)),
        None => payload.insert("KeepAlive".to_owned(), Plist::Bool(true)),
    };
    Plist::Dict(payload)
}

/// Install both LaunchAgents, replacing the loaded ones.
pub fn install_schedule(launchctl: &Launchctl) -> Result<Vec<String>> {
    // launchd does not create a log file's folder.
    std::fs::create_dir_all(state_directory())?;
    let mut installed = Vec::new();
    for job in jobs() {
        let path = home()
            .join("Library/LaunchAgents")
            .join(format!("{}.plist", job.label));
        install_launch_agent(&path, job.label, &launch_agent_payload(&job), launchctl)?;
        installed.push(match job.interval {
            Some(seconds) => format!("Installed {} every {seconds} seconds", job.label),
            None => format!("Installed {} (always on)", job.label),
        });
    }
    Ok(installed)
}

/// launchctl with the control box's timeout, polled every second.
pub fn launchctl() -> Launchctl {
    Launchctl::new(
        Duration::from_secs_f64(INGESTION.launch_agent_timeout_seconds),
        Duration::from_secs(1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(payload: &Plist) -> &BTreeMap<String, Plist> {
        match payload {
            Plist::Dict(entries) => entries,
            _ => panic!("not a dict"),
        }
    }

    fn strings(value: &Plist) -> Vec<String> {
        match value {
            Plist::Array(items) => items
                .iter()
                .map(|item| match item {
                    Plist::String(text) => text.clone(),
                    _ => panic!("not a string"),
                })
                .collect(),
            _ => panic!("not an array"),
        }
    }

    #[test]
    fn each_agent_runs_one_command_from_this_checkout() {
        let [process, directories] = jobs();
        for (job, schedule) in [
            (&process, ("KeepAlive", Plist::Bool(true))),
            (
                &directories,
                (
                    "StartInterval",
                    Plist::Integer(INGESTION.directory_scrape_interval_seconds as i64),
                ),
            ),
        ] {
            let payload = launch_agent_payload(job);
            let payload = entries(&payload);
            assert_eq!(payload["Label"], Plist::from(job.label));
            assert_eq!(payload[schedule.0], schedule.1);
            assert!(!payload.contains_key(if job.interval.is_some() {
                "KeepAlive"
            } else {
                "StartInterval"
            }));
            assert_eq!(
                strings(&payload["ProgramArguments"]),
                [
                    home().join(".cargo/bin/cargo").to_string_lossy().as_ref(),
                    "run",
                    "--release",
                    "--quiet",
                    "--manifest-path",
                    repository_directory()
                        .join("rust/Cargo.toml")
                        .to_string_lossy()
                        .as_ref(),
                    "--bin",
                    "wat2do-ingest",
                    "--",
                    job.command,
                ]
            );
            assert_eq!(
                payload["WorkingDirectory"],
                Plist::from(
                    repository_directory()
                        .join("backend")
                        .to_string_lossy()
                        .into_owned()
                )
            );
            assert_eq!(payload["RunAtLoad"], Plist::Bool(true));
            assert_eq!(payload["ProcessType"], Plist::from("Background"));
            let Plist::Dict(environment) = &payload["EnvironmentVariables"] else {
                panic!("no environment");
            };
            let Plist::String(path) = &environment["PATH"] else {
                panic!("no PATH");
            };
            let path: Vec<&str> = path.split(':').collect();
            // cargo and Claude Code install their launchers under home, which launchd omits.
            assert_eq!(
                path[..2],
                [
                    home().join(".cargo/bin").to_string_lossy().as_ref(),
                    home().join(".local/bin").to_string_lossy().as_ref()
                ]
            );
            assert!(path.contains(&"/opt/homebrew/bin") && path.contains(&"/usr/bin"));
        }
        let state = state_directory();
        let process = launch_agent_payload(&process);
        assert_eq!(
            entries(&process)["StandardOutPath"],
            Plist::from("/dev/null")
        );
        assert_eq!(
            entries(&process)["StandardErrorPath"],
            Plist::from(
                state
                    .join("process.stderr.log")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        let directories = launch_agent_payload(&directories);
        for stream in ["StandardOutPath", "StandardErrorPath"] {
            assert_eq!(
                entries(&directories)[stream],
                Plist::from(state.join("directories.log").to_string_lossy().into_owned())
            );
        }
    }

    #[test]
    fn the_directory_scrape_repeats_every_twelve_hours() {
        assert_eq!(jobs()[1].interval, Some(43200));
    }
}
