"""List and rerun GitHub Actions workflow runs through the gh CLI.

The Mac runs gh as the logged-in user; launchd finds it through CLAUDE_CODE_PATH on the
LaunchAgent. gh carries the user's own authentication, so no token is stored here.
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone

_GH_TIMEOUT_SECONDS = 60


class GitHubCliError(RuntimeError):
    """gh was missing, unauthenticated, or returned an error."""


@dataclass(frozen=True)
class WorkflowRun:
    """One workflow run, as gh reports it."""

    id: str
    title: str
    url: str
    created_at: float  # epoch seconds, UTC


def _run_gh(arguments: list[str]) -> str:
    try:
        result = subprocess.run(
            ["gh", *arguments], capture_output=True, text=True, timeout=_GH_TIMEOUT_SECONDS
        )
    except FileNotFoundError as exc:
        raise GitHubCliError("gh CLI is not installed or not on PATH") from exc
    except (OSError, subprocess.SubprocessError) as exc:
        raise GitHubCliError(f"gh failed ({type(exc).__name__})") from exc
    if result.returncode:
        raise GitHubCliError((result.stderr or result.stdout or "gh returned an error").strip())
    return result.stdout


def _parse_created_at(value: str) -> float:
    # gh prints RFC3339 UTC, e.g. 2026-10-29T12:45:12Z.
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def list_failed_runs(
    repo: str, workflow: str, lookback_hours: int, *, now=time.time
) -> list[WorkflowRun]:
    """Failed runs of the workflow that started within the lookback window."""
    raw = _run_gh(
        [
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
        ]
    )
    try:
        rows = json.loads(raw or "[]")
    except json.JSONDecodeError as exc:
        raise GitHubCliError("gh returned invalid JSON for the run list") from exc
    cutoff = now() - lookback_hours * 3600
    runs: list[WorkflowRun] = []
    for row in rows:
        try:
            created = _parse_created_at(row["createdAt"])
        except (KeyError, TypeError, ValueError):
            continue
        if created >= cutoff:
            runs.append(
                WorkflowRun(
                    id=str(row["databaseId"]),
                    title=str(row.get("displayTitle", "")),
                    url=str(row.get("url", "")),
                    created_at=created,
                )
            )
    return runs


def rerun_failed_jobs(repo: str, run_id: str) -> None:
    """Rerun only the failed jobs of one run, keeping its run id."""
    _run_gh(["run", "rerun", run_id, "--repo", repo, "--failed"])
