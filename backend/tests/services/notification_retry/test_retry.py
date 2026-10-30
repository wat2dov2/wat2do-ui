from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.notification_retry import retry
from services.notification_retry.github_runs import GitHubCliError, WorkflowRun


def _control(**overrides):
    base = dict(
        github_repo="owner/repo",
        workflow_name="Process Notifications",
        lookback_hours=36,
        login_first_school="guelph",
        reruns_per_day=20,
        max_reruns_per_run=3,
    )
    base.update(overrides)
    return SimpleNamespace(notification_retry=SimpleNamespace(**base))


def _run(run_id):
    return WorkflowRun(
        id=run_id, title=f"run {run_id}", url=f"https://x/{run_id}", created_at=900.0
    )


@pytest.fixture
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(retry, "STATE_DIRECTORY", tmp_path)
    monkeypatch.setattr(retry, "_STATE_PATH", tmp_path / "state.json")


def test_no_failed_runs_skips_relogin_and_reruns(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control())
    monkeypatch.setattr(retry.github_runs, "list_failed_runs", lambda *a, **k: [])
    relogin, rerun = Mock(), Mock()
    monkeypatch.setattr(retry, "_recover_login", relogin)
    monkeypatch.setattr(retry.github_runs, "rerun_failed_jobs", rerun)

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["failed_runs"] == 0
    relogin.assert_not_called()
    rerun.assert_not_called()


def test_relogin_first_then_rerun_each_failed_run(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control())
    monkeypatch.setattr(
        retry.github_runs, "list_failed_runs", lambda *a, **k: [_run("1"), _run("2")]
    )
    monkeypatch.setattr(retry, "_recover_login", lambda school, now: True)
    rerun = Mock()
    monkeypatch.setattr(retry.github_runs, "rerun_failed_jobs", rerun)

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["reran"] == ["1", "2"]
    assert result["relogin"] is True
    assert rerun.call_count == 2


def test_run_past_its_cap_is_escalated_not_reran(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control(max_reruns_per_run=2))
    monkeypatch.setattr(retry.github_runs, "list_failed_runs", lambda *a, **k: [_run("1")])
    monkeypatch.setattr(retry, "_recover_login", lambda school, now: False)
    rerun = Mock()
    monkeypatch.setattr(retry.github_runs, "rerun_failed_jobs", rerun)
    retry._save_state({"runs": {"1": {"count": 2, "last_at": 999.0}}, "rerun_timestamps": []})

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["escalated"] == ["1"]
    assert result["reran"] == []
    rerun.assert_not_called()


def test_daily_cap_skips_further_reruns(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control(reruns_per_day=1))
    monkeypatch.setattr(
        retry.github_runs, "list_failed_runs", lambda *a, **k: [_run("1"), _run("2")]
    )
    monkeypatch.setattr(retry, "_recover_login", lambda school, now: True)
    monkeypatch.setattr(retry.github_runs, "rerun_failed_jobs", lambda repo, run_id: None)

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["reran"] == ["1"]
    assert result["skipped"] == ["2"]


def test_list_error_reports_and_never_touches_brave(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control())

    def boom(*a, **k):
        raise GitHubCliError("gh not authenticated")

    monkeypatch.setattr(retry.github_runs, "list_failed_runs", boom)
    relogin = Mock()
    monkeypatch.setattr(retry, "_recover_login", relogin)

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["error"] == "gh not authenticated"
    relogin.assert_not_called()


def test_rerun_failure_skips_that_run_only(isolated_state, monkeypatch):
    monkeypatch.setattr(retry, "controlbox", _control())
    monkeypatch.setattr(
        retry.github_runs, "list_failed_runs", lambda *a, **k: [_run("1"), _run("2")]
    )
    monkeypatch.setattr(retry, "_recover_login", lambda school, now: True)

    def rerun(repo, run_id):
        if run_id == "1":
            raise GitHubCliError("transient")

    monkeypatch.setattr(retry.github_runs, "rerun_failed_jobs", rerun)

    result = retry.retry_failed_notifications(now=lambda: 1000.0)

    assert result["skipped"] == ["1"]
    assert result["reran"] == ["2"]
