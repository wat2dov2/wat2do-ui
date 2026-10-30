import json
import subprocess

import pytest

from services.notification_retry import github_runs
from services.notification_retry.github_runs import GitHubCliError


def test_list_failed_runs_filters_by_lookback(monkeypatch):
    rows = [
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
    ]
    monkeypatch.setattr(github_runs, "_run_gh", lambda args: json.dumps(rows))
    now = github_runs._parse_created_at("2026-10-29T18:00:00Z")

    runs = github_runs.list_failed_runs("owner/repo", "Process Notifications", 36, now=lambda: now)

    assert [run.id for run in runs] == ["1"]
    assert runs[0].title == "fresh"


def test_rerun_failed_jobs_reruns_only_failed_jobs(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(github_runs, "_run_gh", lambda args: calls.append(args) or "")

    github_runs.rerun_failed_jobs("owner/repo", "77")

    assert calls == [["run", "rerun", "77", "--repo", "owner/repo", "--failed"]]


def test_missing_gh_is_reported(monkeypatch):
    def missing(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(subprocess, "run", missing)
    with pytest.raises(GitHubCliError, match="not installed"):
        github_runs._run_gh(["run", "list"])


def test_gh_error_exit_is_reported(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 1, stdout="", stderr="gh: not logged in"),
    )
    with pytest.raises(GitHubCliError, match="not logged in"):
        github_runs._run_gh(["run", "list"])
