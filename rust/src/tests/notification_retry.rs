//! Ported from `tests/services/notification_retry/test_retry.py`,
//! `tests/services/notification_retry/test_github_runs.py` and
//! `tests/jobs/test_retry_failed_notifications.py`.
//!
//! Python patched `github_runs` and `_recover_login`; here a fake `RetryServices`
//! records each call. `gh` itself runs on a `FakeHost`, the state file lives in a
//! temporary directory, and the controls come from
//! `controlbox::overrides::notification_retry`.

use std::cell::RefCell;
use std::path::Path;
use std::sync::Mutex;

use super::*;
use crate::controlbox::overrides;
use crate::instagram_notifications::test_support::{FakeHost, HostCall, failed};

/// Python's `_control(**overrides)`.
fn control_with(change: impl FnOnce(&mut crate::controlbox::NotificationRetry)) {
    overrides::notification_retry(|control| {
        control.github_repo = "owner/repo".into();
        control.workflow_name = "Process Notifications".into();
        control.lookback_hours = 36;
        control.login_first_school = "guelph".into();
        control.reruns_per_day = 20;
        control.max_reruns_per_run = 3;
        change(control);
    });
}

fn workflow_run(run_id: &str) -> WorkflowRun {
    WorkflowRun {
        id: run_id.into(),
        title: format!("run {run_id}"),
        url: format!("https://x/{run_id}"),
        created_at: 900.0,
    }
}

type Rerun = Box<dyn Fn(&str) -> Result<(), GitHubCliError>>;

struct FakeRetry {
    runs: Result<Vec<WorkflowRun>, GitHubCliError>,
    relogin: Option<bool>,
    rerun: Rerun,
    listed: RefCell<Vec<(String, String, u32, f64)>>,
    relogins: RefCell<Vec<String>>,
    reruns: RefCell<Vec<(String, String)>>,
}

impl FakeRetry {
    fn new(runs: Vec<WorkflowRun>, relogin: Option<bool>) -> Self {
        Self {
            runs: Ok(runs),
            relogin,
            rerun: Box::new(|_| Ok(())),
            listed: RefCell::new(Vec::new()),
            relogins: RefCell::new(Vec::new()),
            reruns: RefCell::new(Vec::new()),
        }
    }
}

impl RetryServices for FakeRetry {
    fn list_failed_runs(
        &self,
        repo: &str,
        workflow: &str,
        lookback_hours: u32,
        now: f64,
    ) -> Result<Vec<WorkflowRun>, GitHubCliError> {
        self.listed
            .borrow_mut()
            .push((repo.to_owned(), workflow.to_owned(), lookback_hours, now));
        self.runs.clone()
    }

    fn rerun_failed_jobs(&self, repo: &str, run_id: &str) -> Result<(), GitHubCliError> {
        self.reruns
            .borrow_mut()
            .push((repo.to_owned(), run_id.to_owned()));
        (self.rerun)(run_id)
    }

    fn recover_login(&self, login_first_school: &str) -> Option<bool> {
        self.relogins
            .borrow_mut()
            .push(login_first_school.to_owned());
        self.relogin
    }
}

fn retry(services: &FakeRetry, state: &Path) -> Value {
    retry_failed_notifications(services, state, &|| 1000.0)
}

fn ids(result: &Value, key: &str) -> Vec<String> {
    result[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn test_no_failed_runs_skips_relogin_and_reruns() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::new(vec![], Some(true));

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(result["failed_runs"], 0);
    assert!(services.relogins.borrow().is_empty());
    assert!(services.reruns.borrow().is_empty());
    assert_eq!(
        *services.listed.borrow(),
        vec![(
            "owner/repo".to_owned(),
            "Process Notifications".to_owned(),
            36,
            1000.0
        )]
    );
}

#[test]
fn test_relogin_first_then_rerun_each_failed_run() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::new(vec![workflow_run("1"), workflow_run("2")], Some(true));

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "reran"), vec!["1", "2"]);
    assert_eq!(result["relogin"], true);
    assert_eq!(services.reruns.borrow().len(), 2);
    assert_eq!(*services.relogins.borrow(), vec!["guelph".to_owned()]);
}

#[test]
fn test_run_past_its_cap_is_escalated_not_reran() {
    control_with(|control| control.max_reruns_per_run = 2);
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state.json");
    std::fs::write(
        &state,
        json!({"runs": {"1": {"count": 2, "last_at": 999.0}}, "rerun_timestamps": []}).to_string(),
    )
    .unwrap();
    let services = FakeRetry::new(vec![workflow_run("1")], Some(false));

    let result = retry(&services, &state);

    assert_eq!(ids(&result, "escalated"), vec!["1"]);
    assert!(ids(&result, "reran").is_empty());
    assert!(services.reruns.borrow().is_empty());
}

#[test]
fn test_daily_cap_skips_further_reruns() {
    control_with(|control| control.reruns_per_day = 1);
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::new(vec![workflow_run("1"), workflow_run("2")], Some(true));

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "reran"), vec!["1"]);
    assert_eq!(ids(&result, "skipped"), vec!["2"]);
}

#[test]
fn test_list_error_reports_and_never_touches_brave() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry {
        runs: Err(GitHubCliError("gh not authenticated".into())),
        ..FakeRetry::new(vec![], Some(true))
    };

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(result["error"], "gh not authenticated");
    assert!(services.relogins.borrow().is_empty());
}

#[test]
fn test_rerun_failure_skips_that_run_only() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry {
        rerun: Box::new(|run_id| {
            if run_id == "1" {
                Err(GitHubCliError("transient".into()))
            } else {
                Ok(())
            }
        }),
        ..FakeRetry::new(vec![workflow_run("1"), workflow_run("2")], Some(true))
    };

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "skipped"), vec!["1"]);
    assert_eq!(ids(&result, "reran"), vec!["2"]);
}

// test_github_runs.py: `gh` runs on a FakeHost.

type GhCalls = Arc<Mutex<Vec<Vec<String>>>>;

fn gh_host(stdout: String) -> (Arc<FakeHost>, GhCalls) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let host = FakeHost::new(move |call: &HostCall| {
        assert_eq!(call.program, "gh");
        seen.lock().unwrap().push(call.args.clone());
        Ok(crate::host::CommandOutput {
            code: 0,
            stdout: stdout.clone(),
            stderr: String::new(),
        })
    });
    (host, calls)
}

#[test]
fn test_list_failed_runs_filters_by_lookback() {
    let rows = json!([
        {
            "databaseId": 1,
            "displayTitle": "fresh",
            "url": "u1",
            "createdAt": "2026-10-29T12:00:00Z",
        },
        {
            "databaseId": 2,
            "displayTitle": "stale",
            "url": "u2",
            "createdAt": "2026-10-01T00:00:00Z",
        },
    ]);
    let (host, calls) = gh_host(rows.to_string());
    let now = parse_created_at(&json!("2026-10-29T18:00:00Z")).unwrap();

    let runs = list_failed_runs(
        host.as_ref(),
        "owner/repo",
        "Process Notifications",
        36,
        now,
    )
    .unwrap();

    assert_eq!(
        runs.iter().map(|run| run.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );
    assert_eq!(runs[0].title, "fresh");
    assert_eq!(
        calls.lock().unwrap()[0],
        [
            "run",
            "list",
            "--repo",
            "owner/repo",
            "--workflow",
            "Process Notifications",
            "--status",
            "failure",
            "--limit",
            "100",
            "--json",
            "databaseId,displayTitle,url,createdAt",
        ]
        .map(str::to_owned)
        .to_vec()
    );
}

#[test]
fn test_rerun_failed_jobs_reruns_only_failed_jobs() {
    let (host, calls) = gh_host(String::new());

    rerun_failed_jobs(host.as_ref(), "owner/repo", "77").unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            ["run", "rerun", "77", "--repo", "owner/repo", "--failed"]
                .map(str::to_owned)
                .to_vec()
        ]
    );
}

#[test]
fn test_missing_gh_is_reported() {
    let host = FakeHost::idle();

    let GitHubCliError(error) = run_gh(host.as_ref(), &["run", "list"]).unwrap_err();

    assert!(error.contains("not installed"), "{error}");
}

#[test]
fn test_gh_error_exit_is_reported() {
    let host = FakeHost::new(|_| failed("gh: not logged in"));

    let GitHubCliError(error) = run_gh(host.as_ref(), &["run", "list"]).unwrap_err();

    assert!(error.contains("not logged in"), "{error}");
}

// test_retry_failed_notifications.py (the LaunchAgent payload is tested with the CLI).

#[test]
fn test_run_command_prints_result_and_exits_zero() {
    let state = tempfile::tempdir().unwrap();
    let services = FakeRetry::new(Vec::new(), None);
    let (code, printed) = run_once(&services, &state.path().join("state.json"), &|| 1000.0);
    assert_eq!(code, 0);
    let result: Value = serde_json::from_str(&printed).unwrap();
    assert_eq!(result["failed_runs"], 0);
    assert_eq!(
        printed,
        r#"{"escalated": [], "failed_runs": 0, "relogin": null, "reran": [], "skipped": []}"#
    );
}

#[test]
fn test_run_command_exits_nonzero_on_error() {
    let state = tempfile::tempdir().unwrap();
    let mut services = FakeRetry::new(Vec::new(), None);
    services.runs = Err(GitHubCliError("gh not authenticated".into()));
    let (code, printed) = run_once(&services, &state.path().join("state.json"), &|| 1000.0);
    assert_eq!(code, 1);
    assert!(printed.contains(r#""error": "gh not authenticated""#));
}
