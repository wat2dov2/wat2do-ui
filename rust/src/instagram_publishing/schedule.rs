//! The carousel LaunchAgent: `curate` at each of the control box's
//! `curation_hours` (Python's `generate_instagram_posts.py install-schedule`).
//! Installing it also removes the 9:35 `publish` agent earlier releases
//! installed, since the emulator worker's Claude sitting now posts each
//! school's carousel (`publish-draft`).
//!
//! It runs `cargo run --release` against the checkout this binary was built
//! from, as the ingestion agents do, so a moved runtime checkout runs its own
//! code and prompt. It keeps no logs: each run prints one line of totals.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result};

use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::host::RealHost;
use crate::launch_agents::{
    Launchctl, Plist, agent_path, claude_code_path, home, install_launch_agent,
    remove_launch_agent, repository_directory,
};

pub const CURATE_LABEL: &str = "io.wat2do.instagram.curate";
/// The 9:35 publish agent earlier releases installed.
const RETIRED_PUBLISH_LABEL: &str = "io.wat2do.instagram.publish";

/// One scheduled `wat2do-instagram` subcommand and its daily times.
pub struct Job {
    pub label: &'static str,
    pub command: &'static str,
    pub times: Vec<(u32, u32)>,
}

pub fn jobs() -> [Job; 1] {
    let control = &*INSTAGRAM_PUBLISHING;
    [Job {
        label: CURATE_LABEL,
        command: "curate",
        times: control
            .curation_hours
            .iter()
            .map(|hour| (*hour, control.curation_minute))
            .collect(),
    }]
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
        "wat2do-instagram",
        "--",
        job.command,
    ]
    .map(Plist::from);
    let path = format!(
        "{}:{}",
        cargo.parent().expect("cargo is in a folder").display(),
        claude_code_path()
    );
    let times = job
        .times
        .iter()
        .map(|(hour, minute)| {
            Plist::Dict(BTreeMap::from([
                ("Hour".to_owned(), Plist::Integer(i64::from(*hour))),
                ("Minute".to_owned(), Plist::Integer(i64::from(*minute))),
            ]))
        })
        .collect();
    Plist::Dict(BTreeMap::from([
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
        ("StartCalendarInterval".to_owned(), Plist::Array(times)),
        ("ProcessType".to_owned(), "Background".into()),
        ("StandardOutPath".to_owned(), "/dev/null".into()),
        ("StandardErrorPath".to_owned(), "/dev/null".into()),
    ]))
}

/// Install each job's LaunchAgent, replacing the loaded one, then remove the
/// retired publish agent if it is still there.
pub fn install_schedule(launchctl: &Launchctl) -> Result<()> {
    for job in jobs() {
        // An interrupt between agents leaves the next one as it was.
        launchctl.check_interrupted()?;
        install_launch_agent(
            &agent_path(job.label),
            job.label,
            &launch_agent_payload(&job),
            launchctl,
        )?;
        println!("Installed {}", job.label);
    }
    launchctl.check_interrupted()?;
    let removed = remove_launch_agent(
        &agent_path(RETIRED_PUBLISH_LABEL),
        RETIRED_PUBLISH_LABEL,
        launchctl,
    )
    .with_context(|| format!("could not remove {RETIRED_PUBLISH_LABEL}"))?;
    if removed {
        println!("Removed {RETIRED_PUBLISH_LABEL}");
    }
    Ok(())
}

/// launchctl with the control box's timeout, polled every second; SIGINT and
/// SIGTERM put a replaced agent back before the install stops.
pub fn launchctl() -> Result<Launchctl> {
    Launchctl::new(
        RealHost::shared(),
        Duration::from_secs_f64(INSTAGRAM_PUBLISHING.launch_agent_timeout_seconds),
        Duration::from_secs(1),
    )
    .stop_on_signals()
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

    fn times(hours: &[(i64, i64)]) -> Plist {
        Plist::Array(
            hours
                .iter()
                .map(|(hour, minute)| {
                    Plist::Dict(BTreeMap::from([
                        ("Hour".to_owned(), Plist::Integer(*hour)),
                        ("Minute".to_owned(), Plist::Integer(*minute)),
                    ]))
                })
                .collect(),
        )
    }

    #[test]
    fn curate_runs_through_the_day_without_logs() {
        // test_launch_agent_runs_curate_daily_without_logs
        let [curate] = jobs();
        let payload = launch_agent_payload(&curate);
        let payload = entries(&payload);
        assert_eq!(payload["Label"], Plist::from("io.wat2do.instagram.curate"));
        assert_eq!(
            payload["StartCalendarInterval"],
            times(&[(9, 0), (11, 0), (13, 0), (15, 0)])
        );
        let Plist::Array(arguments) = &payload["ProgramArguments"] else {
            panic!("no arguments");
        };
        assert_eq!(arguments.last(), Some(&Plist::from("curate")));
        assert!(arguments.contains(&Plist::from("wat2do-instagram")));
        assert_eq!(payload["StandardOutPath"], Plist::from("/dev/null"));
        assert_eq!(payload["StandardErrorPath"], Plist::from("/dev/null"));
        assert_eq!(payload["ProcessType"], Plist::from("Background"));
        assert!(!payload.contains_key("RunAtLoad"));
        assert_eq!(
            payload["WorkingDirectory"],
            Plist::from(
                repository_directory()
                    .join("backend")
                    .to_string_lossy()
                    .into_owned()
            )
        );
    }
}
