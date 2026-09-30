#!/usr/bin/env python3
"""Dispatch the existing daily workflow from the Mac mini's Toronto-time clock."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import plistlib
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402

CONTROL = controlbox.instagram_publishing
LABEL = "io.wat2do.instagram-publishing.schedule"
STATE_DIRECTORY = Path.home() / "Library/Application Support/Wat2Do/instagram-publishing"


def _github(arguments: list[str]) -> str:
    result = subprocess.run(
        ["gh", *arguments],
        cwd=BACKEND_DIRECTORY.parent,
        capture_output=True,
        text=True,
        timeout=CONTROL.scheduler_request_timeout_seconds,
        check=True,
    )
    return result.stdout


def _runs() -> list[dict[str, Any]]:
    return json.loads(
        _github(
            [
                "run",
                "list",
                "--workflow",
                CONTROL.scheduler_workflow,
                "--branch",
                "main",
                "--limit",
                "50",
                "--json",
                "databaseId,status,conclusion,createdAt,url",
            ]
        )
    )


def _dispatch() -> None:
    _github(["workflow", "run", CONTROL.scheduler_workflow, "--ref", "main"])


def check(state_directory: Path, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(ZoneInfo(CONTROL.generation_timezone))
    if local.hour < CONTROL.generation_hour:
        return {"status": "before_generation_time"}
    state_directory.mkdir(parents=True, exist_ok=True)
    with (state_directory / "scheduler.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "check_already_running"}
        return _check_locked(state_directory, now, local)


def _check_locked(state_directory: Path, now: datetime, local: datetime) -> dict[str, Any]:
    path = state_directory / "scheduler.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    today = local.date().isoformat()
    if state.get("local_date") != today:
        state = {"local_date": today, "attempts": 0}
    due = local.replace(hour=CONTROL.generation_hour, minute=0, second=0, microsecond=0)
    runs = _runs()
    # An earlier date's active run also owns the workflow concurrency slot.
    if any(run["status"] != "completed" for run in runs):
        return {"status": "workflow_active", "local_date": today}
    todays_runs = [
        run
        for run in runs
        if datetime.fromisoformat(run["createdAt"].replace("Z", "+00:00")) >= due
    ]
    if any(run["conclusion"] == "success" for run in todays_runs):
        return {"status": "complete", "local_date": today}
    last_attempt = state.get("last_attempt")
    if last_attempt:
        elapsed = (now - datetime.fromisoformat(last_attempt)).total_seconds()
        if elapsed < CONTROL.scheduler_retry_interval_seconds:
            return {"status": "retry_wait", **state}
    if state["attempts"] >= CONTROL.scheduler_maximum_attempts:
        return {"status": "attempts_exhausted", **state}
    state.update(attempts=state["attempts"] + 1, last_attempt=now.isoformat())
    # Persist before dispatch: a timeout or process interruption cannot create a rapid duplicate.
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)
    _dispatch()
    return {"status": "dispatched", **state}


def launch_agent_payload(state_directory: Path) -> dict[str, Any]:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            sys.executable,
            str(Path(__file__).resolve()),
            "--state-directory",
            str(state_directory),
            "check",
        ],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONUNBUFFERED": "1",
        },
        "RunAtLoad": True,
        "StartCalendarInterval": {"Hour": CONTROL.generation_hour, "Minute": 0},
        "StartInterval": CONTROL.scheduler_check_interval_seconds,
        "ProcessType": "Background",
        "StandardOutPath": str(state_directory / "scheduler.stdout.log"),
        "StandardErrorPath": str(state_directory / "scheduler.stderr.log"),
    }


def install(state_directory: Path) -> dict[str, str]:
    if sys.platform != "darwin":
        raise ValueError("The publishing scheduler requires macOS")
    local_zone = Path("/etc/localtime").resolve()
    if not str(local_zone).endswith("/" + CONTROL.generation_timezone):
        raise ValueError("Mac timezone must match " + CONTROL.generation_timezone)
    state_directory.mkdir(parents=True, exist_ok=True)
    destination = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(plistlib.dumps(launch_agent_payload(state_directory), sort_keys=True))
    destination.chmod(0o600)
    domain = f"gui/{os.getuid()}"
    for index, operation in enumerate(["bootout", "enable", "bootstrap"]):
        target = f"{domain}/{LABEL}" if operation == "enable" else domain
        command = ["launchctl", operation, target]
        if operation != "enable":
            command.append(str(destination))
        subprocess.run(
            command,
            check=index > 0,
            capture_output=True,
            text=True,
            timeout=CONTROL.scheduler_request_timeout_seconds,
        )
    return {"installed": LABEL, "plist": str(destination)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-directory", type=Path, default=STATE_DIRECTORY)
    parser.add_argument("command", choices=["check", "install"])
    arguments = parser.parse_args()
    result = (
        install(arguments.state_directory)
        if arguments.command == "install"
        else check(arguments.state_directory)
    )
    print(json.dumps(result, sort_keys=True))
    return 1 if result.get("status") == "attempts_exhausted" else 0


if __name__ == "__main__":
    raise SystemExit(main())
