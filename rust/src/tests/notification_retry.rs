//! Ported from `tests/services/notification_retry/test_retry.py`,
//! `tests/services/notification_retry/test_github_runs.py` and
//! `tests/jobs/test_retry_failed_notifications.py`.
//!
//! Python patched `github_runs`; here a fake `RetryServices` records each call and
//! answers what the worker can run. `gh` itself runs on a `FakeHost`, the state file lives in a
//! temporary directory, and the controls come from
//! `controlbox::overrides::notification_retry`.

use std::cell::RefCell;
use std::collections::BTreeMap;
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
        control.reruns_per_day = 20;
        control.max_reruns_per_run = 3;
        control.rerun_spacing_minutes = 30;
        change(control);
    });
}

fn workflow_run(run_id: &str) -> WorkflowRun {
    WorkflowRun {
        id: run_id.into(),
        title: format!("poster{run_id} and 3 others - wat2do.school{run_id}"),
        url: format!("https://x/{run_id}"),
        created_at: 900.0,
    }
}

fn titled(run_id: &str, title: &str) -> WorkflowRun {
    WorkflowRun {
        title: title.into(),
        ..workflow_run(run_id)
    }
}

type Rerun = Box<dyn Fn(&str) -> Result<(), GitHubCliError>>;

struct FakeRetry {
    runs: Result<Vec<WorkflowRun>, GitHubCliError>,
    readiness: Option<Readiness>,
    rerun: Rerun,
    listed: RefCell<Vec<(String, String, u32, f64)>>,
    readiness_reads: RefCell<usize>,
    reruns: RefCell<Vec<(String, String)>>,
}

impl FakeRetry {
    fn new(runs: Vec<WorkflowRun>, readiness: Option<Readiness>) -> Self {
        Self {
            runs: Ok(runs),
            readiness,
            rerun: Box::new(|_| Ok(())),
            listed: RefCell::new(Vec::new()),
            readiness_reads: RefCell::new(0),
            reruns: RefCell::new(Vec::new()),
        }
    }

    /// The worker runs digests for every account.
    fn ready(runs: Vec<WorkflowRun>) -> Self {
        Self::new(runs, Some(Readiness::default()))
    }

    fn reran(&self) -> Vec<String> {
        self.reruns
            .borrow()
            .iter()
            .map(|(_, run_id)| run_id.clone())
            .collect()
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

    fn readiness(&self) -> Option<Readiness> {
        *self.readiness_reads.borrow_mut() += 1;
        self.readiness.clone()
    }
}

fn retry(services: &FakeRetry, state: &Path) -> Value {
    retry_at(services, state, 1000.0)
}

fn retry_at(services: &FakeRetry, state: &Path, now: f64) -> Value {
    retry_failed_notifications(services, state, &|| now)
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
fn test_no_failed_runs_reads_nothing_else() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::ready(vec![]);

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(result["failed_runs"], 0);
    assert_eq!(*services.readiness_reads.borrow(), 0);
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
fn test_reruns_each_failed_run_while_the_worker_runs() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::ready(vec![workflow_run("1"), workflow_run("2")]);

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "reran"), vec!["1", "2"]);
    assert_eq!(services.reran(), vec!["1", "2"]);
    assert_eq!(result["blocked"], Value::Null);
}

#[test]
fn test_nothing_is_reran_or_spent_while_the_worker_is_paused() {
    // 11-13: Brave sat logged out from 10:17 to 21:51 and every rerun would have failed.
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state.json");
    let paused = Readiness {
        blocked: Some("the Instagram browser worker is paused: logged out".to_owned()),
        ..Readiness::default()
    };
    let services = FakeRetry::new(vec![workflow_run("1")], Some(paused));

    let result = retry(&services, &state);

    assert_eq!(
        result["blocked"],
        "the Instagram browser worker is paused: logged out"
    );
    assert!(services.reruns.borrow().is_empty());
    // An unreadable queue blocks the same way.
    let services = FakeRetry::new(vec![workflow_run("1")], None);
    assert!(retry(&services, &state)["blocked"].is_string());
    assert!(services.reruns.borrow().is_empty());
    // Once the worker runs, the run gets every one of its reruns.
    let services = FakeRetry::ready(vec![workflow_run("1")]);
    assert_eq!(ids(&retry(&services, &state), "reran"), vec!["1"]);
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&state).unwrap()).unwrap();
    assert_eq!(saved["runs"]["1"]["count"], 1);
}

#[test]
fn test_a_run_waits_while_its_account_cannot_run() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state.json");
    let runs = vec![
        titled("1", "sfuastronomyclub and 24 others - wat2do.sfu"),
        titled("2", "ubcaseac and 138 others - wat2do.ubc"),
        titled("3", "dance and 2 others - sfu.wat2do.io"),
    ];
    let readiness = Readiness {
        blocked: None,
        unavailable: BTreeMap::from([(
            "wat2do.sfu".to_owned(),
            "missing from Brave until its login is allowed again".to_owned(),
        )]),
    };
    let services = FakeRetry::new(runs.clone(), Some(readiness));

    let result = retry(&services, &state);

    // An old switcher name is the same account.
    assert_eq!(ids(&result, "waiting"), vec!["1", "3"]);
    assert_eq!(services.reran(), vec!["2"]);
    // Back in Brave: its runs are reran, none of their reruns spent while waiting.
    let services = FakeRetry::ready(runs);
    let result = retry_at(&services, &state, 1000.0 + 60.0);
    assert_eq!(services.reran(), vec!["1", "3"]);
    assert_eq!(ids(&result, "waiting"), vec!["2"], "reran a minute ago");
}

#[test]
fn test_a_failing_run_is_reran_again_only_after_the_spacing() {
    control_with(|control| control.rerun_spacing_minutes = 30);
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state.json");
    let services = FakeRetry::ready(vec![workflow_run("1")]);
    retry_at(&services, &state, 1000.0);
    retry_at(&services, &state, 1000.0 + 29.0 * 60.0);
    assert_eq!(services.reran(), vec!["1"]);
    retry_at(&services, &state, 1000.0 + 30.0 * 60.0);
    assert_eq!(services.reran(), vec!["1", "1"]);
}

#[test]
fn test_unroutable_runs_are_never_reran() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::ready(vec![titled("1", " - "), titled("2", "Process @club")]);

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "skipped"), vec!["1"]);
    // A manual run names no account and is reran.
    assert_eq!(services.reran(), vec!["2"]);
}

#[test]
fn test_run_account_reads_the_title() {
    assert_eq!(
        run_account("michigandaily and 134 others - wat2do.umich"),
        RunAccount::Named("wat2do.umich".to_owned())
    );
    assert_eq!(
        run_account("Husayniyyah Toronto Met | Downtown Toronto - wat2do.tmu"),
        RunAccount::Named("wat2do.tmu".to_owned())
    );
    assert_eq!(
        run_account("A - B - wat2do.ubc"),
        RunAccount::Named("wat2do.ubc".to_owned())
    );
    assert_eq!(run_account("Process @club"), RunAccount::Unnamed);
    for unroutable in [" - ", "-", "poster - ", "poster -"] {
        assert_eq!(
            run_account(unroutable),
            RunAccount::Unroutable,
            "{unroutable:?}"
        );
    }
}

#[test]
fn test_run_past_its_cap_is_escalated_once_not_reran() {
    control_with(|control| control.max_reruns_per_run = 2);
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("state.json");
    std::fs::write(
        &state,
        json!({"runs": {"1": {"count": 2, "last_at": 999.0}}, "rerun_timestamps": []}).to_string(),
    )
    .unwrap();
    let services = FakeRetry::ready(vec![workflow_run("1")]);

    let result = retry(&services, &state);

    assert_eq!(ids(&result, "escalated"), vec!["1"]);
    assert!(ids(&result, "reran").is_empty());
    assert!(services.reruns.borrow().is_empty());
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&state).unwrap()).unwrap();
    assert_eq!(saved["runs"]["1"]["reported"], true);
}

#[test]
fn test_daily_cap_skips_further_reruns() {
    control_with(|control| control.reruns_per_day = 1);
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry::ready(vec![workflow_run("1"), workflow_run("2")]);

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(ids(&result, "reran"), vec!["1"]);
    assert_eq!(ids(&result, "skipped"), vec!["2"]);
}

#[test]
fn test_list_error_reports_and_never_reads_the_worker() {
    control_with(|_| {});
    let directory = tempfile::tempdir().unwrap();
    let services = FakeRetry {
        runs: Err(GitHubCliError("gh not authenticated".into())),
        ..FakeRetry::ready(vec![])
    };

    let result = retry(&services, &directory.path().join("state.json"));

    assert_eq!(result["error"], "gh not authenticated");
    assert_eq!(*services.readiness_reads.borrow(), 0);
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
        ..FakeRetry::ready(vec![workflow_run("1"), workflow_run("2")])
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
        r#"{"blocked": null, "escalated": [], "failed_runs": 0, "reran": [], "skipped": [], "waiting": []}"#
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
