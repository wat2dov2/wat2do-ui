//! Running Claude Code headless as a scoped local agent (`services/claude_code.py`).
//!
//! A prompt on stdin, only the named tools, no MCP servers or saved session, and
//! a JSON schema the answer must match. Claude Code's folder for the run under
//! `~/.claude/projects` is removed afterwards. A run Claude turns away because
//! the account's usage limit is reached fails with [`Limited`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::{Result, anyhow, bail};
use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, TimeDelta, TimeZone, Utc};
use chrono_tz::Tz;
use regex::Regex;
use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub struct Agent<'a> {
    /// Names the agent in its errors, such as "Ingestion agent".
    pub name: &'static str,
    pub model: &'a str,
    pub tools: &'a [&'a str],
    pub allowed_tools: &'a [&'a str],
    pub schema: &'a Value,
    pub timeout: Duration,
    pub env: HashMap<String, String>,
}

/// Claude turned the run away (HTTP 429) because the account's usage limit is
/// reached. Every run fails this way until the limit resets, whatever it was given.
#[derive(Debug)]
pub struct Limited {
    pub agent: &'static str,
    /// Claude Code's words, such as "You've hit your 5-hour limit · resets 5:10am (America/Toronto)".
    pub message: String,
    /// When the limit lifts, if the message says.
    pub resets_at: Option<DateTime<Utc>>,
}

impl std::fmt::Display for Limited {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} hit Claude's usage limit ({})",
            self.agent, self.message
        )
    }
}

impl std::error::Error for Limited {}

/// Run one agent in `workdir` and return its answer, which matches the schema.
pub async fn run_agent(
    prompt: &str,
    workdir: &Path,
    agent: Agent<'_>,
) -> Result<Map<String, Value>> {
    let result = run(prompt, workdir, &agent).await;
    remove_run_folder(workdir);
    result
}

async fn run(prompt: &str, workdir: &Path, agent: &Agent<'_>) -> Result<Map<String, Value>> {
    let name = agent.name;
    let failed = |error: std::io::Error| anyhow!("{name} failed ({})", error.kind());
    let mut child = Command::new("claude")
        .arg("-p")
        .args(["--model", agent.model])
        .args(["--tools", &agent.tools.join(",")])
        .arg("--allowedTools")
        .args(agent.allowed_tools)
        .args(["--permission-mode", "dontAsk"])
        .arg("--strict-mcp-config")
        .arg("--no-session-persistence")
        .args(["--output-format", "json"])
        .args(["--json-schema", &agent.schema.to_string()])
        .current_dir(workdir)
        .env_clear()
        .envs(&agent.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(failed)?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    stdin.write_all(prompt.as_bytes()).await.map_err(failed)?;
    drop(stdin);
    let output = tokio::time::timeout(agent.timeout, child.wait_with_output())
        .await
        .map_err(|_| anyhow!("{name} failed (timed out)"))?
        .map_err(failed)?;
    // Claude Code prints its result as JSON even when the run failed.
    let answer: Value = serde_json::from_slice(&output.stdout).unwrap_or_default();
    if let Some(limited) = limited(name, &answer, Utc::now()) {
        return Err(limited.into());
    }
    if !output.status.success() {
        bail!(
            "{name} failed (exit {})",
            output.status.code().unwrap_or(-1)
        );
    }
    match answer.get("structured_output") {
        Some(Value::Object(answer)) => Ok(answer.clone()),
        _ => bail!("{name} gave no answer"),
    }
}

/// The usage limit Claude turned the run away for, when the run ended on HTTP 429.
fn limited(agent: &'static str, answer: &Value, now: DateTime<Utc>) -> Option<Limited> {
    if answer.get("api_error_status").and_then(Value::as_u64) != Some(429) {
        return None;
    }
    let message = answer
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Some(Limited {
        agent,
        resets_at: reset_time(&message, now),
        message,
    })
}

/// "resets 5:10am (America/Toronto)" when the reset is within a day, otherwise
/// "resets Nov 8, 5am (America/Toronto)", with the year when it is another year's.
static RESETS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"resets (?:(?P<month>[A-Z][a-z]{2}) (?P<day>\d{1,2}), (?:(?P<year>\d{4}), )?)?(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?P<half>[ap]m) \((?P<zone>[^)]+)\)",
    )
    .expect("valid regex")
});

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// When the limit in Claude Code's message lifts: the end of the minute it names,
/// since the message leaves out seconds.
fn reset_time(message: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let found = RESETS.captures(message)?;
    let zone: Tz = found["zone"].parse().ok()?;
    let hour: u32 = found["hour"]
        .parse()
        .ok()
        .filter(|hour| (1..=12).contains(hour))?;
    let hour = hour % 12 + if &found["half"] == "pm" { 12 } else { 0 };
    let minute = match found.name("minute") {
        Some(minute) => minute.as_str().parse().ok()?,
        None => 0,
    };
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    let local_now = now.with_timezone(&zone);
    let date = match found.name("month") {
        Some(month) => {
            let month = MONTHS.iter().position(|name| *name == month.as_str())? as u32 + 1;
            let year = match found.name("year") {
                Some(year) => year.as_str().parse().ok()?,
                None => local_now.year(),
            };
            NaiveDate::from_ymd_opt(year, month, found["day"].parse().ok()?)?
        }
        None => {
            // Today's, or tomorrow's once today's is over an hour gone (one that
            // just passed is today's: the message rounds down to the minute).
            let today = local_now.date_naive();
            let an_hour_ago = (local_now - TimeDelta::hours(1)).naive_local();
            if today.and_time(time) < an_hour_ago {
                today.succ_opt()?
            } else {
                today
            }
        }
    };
    let reset = zone.from_local_datetime(&date.and_time(time)).earliest()?;
    Some(reset.with_timezone(&Utc) + TimeDelta::minutes(1))
}

/// Only what Claude Code itself needs; no application secrets.
pub fn claude_environment() -> HashMap<String, String> {
    ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR"]
        .into_iter()
        .filter_map(|name| {
            std::env::var(name)
                .ok()
                .map(|value| (name.to_owned(), value))
        })
        .collect()
}

fn claude_projects() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude/projects")
}

fn folder_name(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Delete the folder Claude Code keeps for a run, named after its working directory.
pub fn remove_run_folder(workdir: &Path) {
    let real = std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    let _ = std::fs::remove_dir_all(claude_projects().join(folder_name(&real.to_string_lossy())));
}

/// Delete working and Claude Code folders that interrupted runs never cleaned up.
pub fn remove_leftovers(prefix: &str) {
    let marker = folder_name(prefix);
    for (directory, needle) in [
        (std::env::temp_dir(), prefix.to_owned()),
        (claude_projects(), marker),
    ] {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let matches = if directory == claude_projects() {
                name.contains(&needle)
            } else {
                name.starts_with(&needle)
            };
            if matches {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};
    use serde_json::json;

    use super::{limited, reset_time};

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().unwrap()
    }

    #[test]
    fn a_run_turned_away_with_429_is_limited_until_the_reset() {
        // What Claude Code printed when the 5-hour limit was hit on 2026-11-07.
        let answer = json!({
            "type": "result",
            "subtype": "success",
            "is_error": true,
            "api_error_status": 429,
            "result": "You've hit your 5-hour limit · resets 5:10am (America/Toronto)",
        });
        let limited = limited("Ingestion agent", &answer, at("2026-11-07T09:29:45Z")).unwrap();
        assert_eq!(limited.resets_at, Some(at("2026-11-07T10:11:00Z")));
        assert_eq!(
            limited.to_string(),
            "Ingestion agent hit Claude's usage limit \
             (You've hit your 5-hour limit · resets 5:10am (America/Toronto))"
        );
    }

    #[test]
    fn only_a_429_is_a_limit() {
        for answer in [
            json!({"is_error": true, "api_error_status": 500, "result": "API Error: 500"}),
            json!({"is_error": true, "api_error_status": null, "result": "Prompt is too long"}),
            json!({"is_error": false, "result": "", "structured_output": {"outcome": "nothing"}}),
            json!(null),
        ] {
            assert!(
                limited("Ingestion agent", &answer, at("2026-11-07T09:29:45Z")).is_none(),
                "{answer}"
            );
        }
    }

    #[test]
    fn a_limit_without_a_readable_reset_has_no_reset_time() {
        let answer = json!({"is_error": true, "api_error_status": 429, "result": "Rate limited"});
        let limited = limited("Directory agent", &answer, at("2026-11-07T09:29:45Z")).unwrap();
        assert_eq!(limited.resets_at, None);
    }

    #[test]
    fn reset_times_are_read_in_their_own_time_zone() {
        for (message, now, reset) in [
            // Within a day: today's time.
            (
                "resets 5:10am (America/Toronto)",
                "2026-11-07T09:29:45Z",
                "2026-11-07T10:11:00Z",
            ),
            (
                "resets 3pm (America/Toronto)",
                "2026-11-07T15:00:00Z",
                "2026-11-07T20:01:00Z",
            ),
            // Tomorrow's once today's is over an hour gone.
            (
                "resets 2am (America/Toronto)",
                "2026-11-07T04:00:00Z",
                "2026-11-07T07:01:00Z",
            ),
            // One that just passed is still today's.
            (
                "resets 5:10am (America/Toronto)",
                "2026-11-07T10:10:30Z",
                "2026-11-07T10:11:00Z",
            ),
            // Over a day away, with the date, and the year when it is another year's.
            (
                "resets Nov 14, 9am (America/Toronto)",
                "2026-11-07T09:00:00Z",
                "2026-11-14T14:01:00Z",
            ),
            (
                "resets Jan 2, 2027, 5:30am (UTC)",
                "2026-12-30T00:00:00Z",
                "2027-01-02T05:31:00Z",
            ),
        ] {
            assert_eq!(
                reset_time(message, at(now)),
                Some(at(reset)),
                "{message} at {now}"
            );
        }
    }

    #[test]
    fn unreadable_reset_times_are_none() {
        for message in [
            "You've hit your limit",
            "resets soon (America/Toronto)",
            "resets 5:10am (Mars/Olympus_Mons)",
            "resets 13pm (America/Toronto)",
            "resets Foo 3, 5am (America/Toronto)",
        ] {
            assert_eq!(
                reset_time(message, at("2026-11-07T09:00:00Z")),
                None,
                "{message}"
            );
        }
    }
}
