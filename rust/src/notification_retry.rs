//! Daily: log Brave back in (the first school's profile first), then rerun the failed
//! Process Notifications runs so their posts are ingested.
//!
//! A school account that drops out of Brave fails its browser-run notification job. This
//! reuses the capped, saved-profile login recovery of the browser worker and then reruns
//! each failed run, up to a per-run and per-day cap. A run that keeps failing after its
//! cap is reported for a person to re-login that account by hand. `gh` carries the
//! user's own authentication, so no token is stored here.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::NaiveDateTime;
use serde_json::{Map, Value, json};

use crate::controlbox::notification_retry as control;
use crate::host::{CommandError, Host};
use crate::instagram_notifications::account_login::ImapMailbox;
use crate::instagram_notifications::browser_queue::BrowserJobQueue;
use crate::instagram_notifications::browser_session::{Bridge, school_account_username};
use crate::instagram_notifications::browser_worker::Worker;
use crate::launch_agents::{atomic_write, home};

const GH_TIMEOUT_SECONDS: f64 = 60.0;

/// gh was missing, unauthenticated, or returned an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubCliError(pub String);

/// One workflow run, as gh reports it.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowRun {
    pub id: String,
    pub title: String,
    pub url: String,
    /// Epoch seconds, UTC.
    pub created_at: f64,
}

/// What a retry pass reaches outside itself.
pub trait RetryServices {
    fn list_failed_runs(
        &self,
        repo: &str,
        workflow: &str,
        lookback_hours: u32,
        now: f64,
    ) -> Result<Vec<WorkflowRun>, GitHubCliError>;
    fn rerun_failed_jobs(&self, repo: &str, run_id: &str) -> Result<(), GitHubCliError>;
    /// Prefer one school's saved profile, then run the capped Brave relogin: true if it
    /// logged back in, false if there was nothing to recover, None when it could not run.
    fn recover_login(&self, login_first_school: &str) -> Option<bool>;
}

pub fn state_directory() -> PathBuf {
    home().join(".local/state/wat2do/notification-retry")
}

fn run_gh(host: &dyn Host, arguments: &[&str]) -> Result<String, GitHubCliError> {
    let arguments: Vec<String> = arguments
        .iter()
        .map(|argument| (*argument).to_owned())
        .collect();
    let result = host
        .run("gh", &arguments, None, GH_TIMEOUT_SECONDS)
        .map_err(|error| match error {
            CommandError::NotFound => {
                GitHubCliError("gh CLI is not installed or not on PATH".to_owned())
            }
            CommandError::Timeout => GitHubCliError("gh failed (TimeoutExpired)".to_owned()),
            CommandError::Io(_) => GitHubCliError("gh failed (OSError)".to_owned()),
        })?;
    if result.code != 0 {
        let detail = if !result.stderr.is_empty() {
            result.stderr
        } else if !result.stdout.is_empty() {
            result.stdout
        } else {
            "gh returned an error".to_owned()
        };
        return Err(GitHubCliError(detail.trim().to_owned()));
    }
    Ok(result.stdout)
}

/// gh prints RFC3339 UTC, e.g. 2026-10-29T12:45:12Z.
fn parse_created_at(value: &Value) -> Option<f64> {
    let parsed = NaiveDateTime::parse_from_str(value.as_str()?, "%Y-%m-%dT%H:%M:%SZ").ok()?;
    Some(parsed.and_utc().timestamp() as f64)
}

/// Failed runs of the workflow that started within the lookback window.
pub fn list_failed_runs(
    host: &dyn Host,
    repo: &str,
    workflow: &str,
    lookback_hours: u32,
    now: f64,
) -> Result<Vec<WorkflowRun>, GitHubCliError> {
    let raw = run_gh(
        host,
        &[
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            workflow,
            "--status",
            "failure",
            "--limit",
            "100",
            "--json",
            "databaseId,displayTitle,url,createdAt",
        ],
    )?;
    let raw = if raw.is_empty() { "[]" } else { raw.as_str() };
    let rows: Value = serde_json::from_str(raw)
        .map_err(|_| GitHubCliError("gh returned invalid JSON for the run list".to_owned()))?;
    let cutoff = now - f64::from(lookback_hours) * 3600.0;
    let mut runs = Vec::new();
    for row in rows.as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(created) = row.get("createdAt").and_then(parse_created_at) else {
            continue;
        };
        if created >= cutoff {
            let id = row.get("databaseId").ok_or_else(|| {
                GitHubCliError("gh returned a run without its databaseId".to_owned())
            })?;
            let text = |key: &str| row.get(key).map(crate::pyjson::str).unwrap_or_default();
            runs.push(WorkflowRun {
                id: crate::pyjson::str(id),
                title: text("displayTitle"),
                url: text("url"),
                created_at: created,
            });
        }
    }
    Ok(runs)
}

/// Rerun only the failed jobs of one run, keeping its run id.
pub fn rerun_failed_jobs(host: &dyn Host, repo: &str, run_id: &str) -> Result<(), GitHubCliError> {
    run_gh(host, &["run", "rerun", run_id, "--repo", repo, "--failed"]).map(|_| ())
}

fn load_state(path: &std::path::Path) -> Map<String, Value> {
    let mut state = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|state| match state {
            Value::Object(state) => Some(state),
            _ => None,
        })
        .unwrap_or_default();
    if !state.get("runs").is_some_and(Value::is_object) {
        state.insert("runs".into(), json!({}));
    }
    if !state.get("rerun_timestamps").is_some_and(Value::is_array) {
        state.insert("rerun_timestamps".into(), json!([]));
    }
    state
}

fn number(value: Option<&Value>) -> f64 {
    value.and_then(crate::pyjson::number).unwrap_or(0.0)
}

/// Keep a run's history a little past the lookback so a persistent failure keeps
/// escalating instead of being retried fresh; forget the rest.
fn prune(state: &mut Map<String, Value>, now: f64, lookback_hours: u32) {
    let horizon = now - (f64::from(lookback_hours) * 3600.0).max(7.0 * 86_400.0);
    if let Some(Value::Object(runs)) = state.get_mut("runs") {
        runs.retain(|_, entry| number(entry.get("last_at")) >= horizon);
    }
    if let Some(Value::Array(stamps)) = state.get_mut("rerun_timestamps") {
        stamps.retain(|at| now - number(Some(at)) < 86_400.0);
    }
}

/// One pass: recover the Brave login, then rerun failed notification runs.
pub fn retry_failed_notifications(
    services: &dyn RetryServices,
    state_path: &std::path::Path,
    now: &dyn Fn() -> f64,
) -> Value {
    let mut result =
        json!({"failed_runs": 0, "relogin": null, "reran": [], "escalated": [], "skipped": []});
    let failed = match services.list_failed_runs(
        &control().github_repo,
        &control().workflow_name,
        control().lookback_hours,
        now(),
    ) {
        Ok(failed) => failed,
        Err(GitHubCliError(error)) => {
            tracing::error!("Could not list failed notification runs: {error}");
            result["error"] = json!(error);
            return result;
        }
    };
    result["failed_runs"] = json!(failed.len());
    if failed.is_empty() {
        tracing::info!(
            "No failed {} runs in the last {}h; nothing to retry",
            control().workflow_name,
            control().lookback_hours
        );
        return result;
    }
    // Log back in first, the login_first_school's saved profile ahead of any other. This
    // is a no-op unless Brave is actually logged out.
    result["relogin"] = json!(services.recover_login(&control().login_first_school));
    let mut state = load_state(state_path);
    prune(&mut state, now(), control().lookback_hours);
    let mut reruns_today = state["rerun_timestamps"].as_array().map_or(0, Vec::len);
    let push = |result: &mut Value, key: &str, id: &str| {
        result[key]
            .as_array_mut()
            .expect("result lists")
            .push(json!(id));
    };
    for run in &failed {
        let entry = state["runs"]
            .get(&run.id)
            .filter(|entry| crate::pyjson::truthy(entry))
            .cloned()
            .unwrap_or_else(|| json!({"count": 0, "last_at": 0.0}));
        let count = number(entry.get("count")) as i64;
        if count >= control().max_reruns_per_run {
            push(&mut result, "escalated", &run.id);
            let reruns = crate::pyjson::str(entry.get("count").unwrap_or(&Value::Null));
            tracing::warn!(
                "Run {} ({}) still failing after {} reruns; an account likely needs a manual re-login in Brave: {}",
                run.id,
                run.title,
                reruns,
                run.url
            );
            continue;
        }
        if reruns_today >= control().reruns_per_day {
            push(&mut result, "skipped", &run.id);
            continue;
        }
        if let Err(GitHubCliError(error)) =
            services.rerun_failed_jobs(&control().github_repo, &run.id)
        {
            push(&mut result, "skipped", &run.id);
            tracing::error!("Could not rerun {}: {error}", run.id);
            continue;
        }
        let mut entry = entry;
        entry["count"] = json!(count + 1);
        entry["last_at"] = json!(now());
        state["runs"][&run.id] = entry;
        state["rerun_timestamps"]
            .as_array_mut()
            .expect("timestamps are a list")
            .push(json!(now()));
        reruns_today += 1;
        push(&mut result, "reran", &run.id);
        tracing::info!("Reran {} ({})", run.id, run.title);
    }
    let serialized = crate::pyjson::dumps_sorted(&Value::Object(state), None);
    if let Some(parent) = state_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(error) = atomic_write(state_path, serialized.as_bytes()) {
        tracing::error!(
            "Could not save the notification retry state ({})",
            error.kind()
        );
    }
    let length = |key: &str| result[key].as_array().map_or(0, Vec::len);
    let relogin = match &result["relogin"] {
        Value::Bool(true) => "True",
        Value::Bool(false) => "False",
        _ => "None",
    };
    tracing::info!(
        "Notification retry: {} failed, {} reran, {} need a person, {} skipped (relogin={})",
        result["failed_runs"],
        length("reran"),
        length("escalated"),
        length("skipped"),
        relogin
    );
    result
}

pub struct Live {
    pub host: Arc<dyn Host>,
}

impl RetryServices for Live {
    fn list_failed_runs(
        &self,
        repo: &str,
        workflow: &str,
        lookback_hours: u32,
        now: f64,
    ) -> Result<Vec<WorkflowRun>, GitHubCliError> {
        list_failed_runs(self.host.as_ref(), repo, workflow, lookback_hours, now)
    }

    fn rerun_failed_jobs(&self, repo: &str, run_id: &str) -> Result<(), GitHubCliError> {
        rerun_failed_jobs(self.host.as_ref(), repo, run_id)
    }

    fn recover_login(&self, login_first_school: &str) -> Option<bool> {
        // A relogin hiccup must never block the reruns.
        let recovered = (|| -> anyhow::Result<bool> {
            let queue = BrowserJobQueue::open(None, self.host.clone())?;
            queue.set_setting(
                "retrieval_pool_account",
                json!(school_account_username(login_first_school).map_err(anyhow::Error::msg)?),
            )?;
            let worker = Worker::new(
                Bridge::new(self.host.clone(), Arc::new(ImapMailbox)),
                queue,
                None,
            );
            let host = self.host.clone();
            Ok(worker.recover_login(&move || host.time())?)
        })();
        match recovered {
            Ok(recovered) => Some(recovered),
            Err(error) => {
                tracing::error!("Brave login recovery did not run: {error}");
                None
            }
        }
    }
}

/// The `retry-failed-notifications` command: one pass, its result as sorted JSON, and exit 1 when it could not
/// list the failed runs.
pub fn run_once(
    services: &dyn RetryServices,
    state_path: &std::path::Path,
    now: &dyn Fn() -> f64,
) -> (u8, String) {
    let result = retry_failed_notifications(services, state_path, now);
    let code = u8::from(result.get("error").is_some());
    (code, crate::pyjson::dumps_sorted(&result, None))
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/notification_retry.rs"]
mod python_tests;
