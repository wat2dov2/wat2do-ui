"""The hourly watchdog: read everything, judge it, log it, and start the maintenance
agent at once when something is red (at most once per problem per debounce window).
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import subprocess
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services.maintenance import judges, readings

log = logging.getLogger(__name__)

CONTROL = controlbox.maintenance
STATE_DIR = readings.STATE / "maintenance"
WATCHDOG_LOG = STATE_DIR / "watchdog.jsonl"
STATE_FILE = STATE_DIR / "state.json"
# Why the agent was started early; the agent reads and clears it.
TRIGGER_FILE = STATE_DIR / "trigger.json"
AGENT_LABEL = "io.wat2do.maintenance.agent"
WATCHDOG_LABEL = "io.wat2do.maintenance.watchdog"


def _readers(context: readings.Context) -> dict[str, Callable[[], Any]]:
    rows: dict[str, Any] = {}

    def database(part: Callable[[dict[str, Any], readings.Context], Any]) -> Callable[[], Any]:
        def read() -> Any:
            if not rows:
                rows.update(readings.database(context))
            return part(rows, context)

        return read

    return {
        "ingestion": database(readings.ingestion),
        "brave": lambda: readings.brave(context),
        "following_guard": lambda: readings.following_guard(context),
        "ingestion_processor": lambda: readings.ingestion_processor(context),
        "recorder": lambda: readings.recorder(context),
        "account_notifications": lambda: readings.account_notifications(context),
        "workflow": lambda: readings.workflow(context),
        "notification_agent": lambda: readings.notification_agent(context),
        "runners": lambda: readings.runners(context),
        "emulator": lambda: readings.emulator(context),
        "host": lambda: readings.host(context),
        "launch_agents": lambda: readings.launch_agents(context),
        "sittings": lambda: readings.sittings(context),
        "carousels": database(readings.carousels),
        "follows": database(readings.follows),
        "graph_tokens": database(readings.graph_tokens),
        "claude_logins": lambda: readings.claude_logins(context),
    }


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, json.dumps(value, indent=1, sort_keys=True).encode())


def check(*, trigger: bool) -> dict[str, Any]:
    """One pass of every check, appended to the watchdog log. With `trigger`, a red
    check that is due starts the maintenance agent."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (STATE_DIR / "watchdog.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = datetime.now(timezone.utc)
        state = _load_state()
        context = readings.Context(CONTROL, state, now)
        checks = []
        for name, read in _readers(context).items():
            try:
                checks.append(judges.JUDGES[name](read(), CONTROL))
            except Exception as error:  # noqa: BLE001 - one broken reader never hides the rest
                log.warning("Watchdog check %s could not read", name, exc_info=True)
                checks.append(judges.unreadable(name, f"{type(error).__name__}: {error}"[:300]))
        record = {
            "at": now.isoformat(),
            "status": judges.worst(checks),
            "checks": [item.as_dict() for item in checks],
        }
        if trigger:
            record["triggered"] = _trigger(checks, state, now)
        with WATCHDOG_LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
        _save(STATE_FILE, state)
        return record


def _trigger(checks: list[judges.Check], state: dict[str, Any], now: datetime) -> list[str]:
    today = now.astimezone(readings.TORONTO).date().isoformat()
    runs = state.setdefault("triggered_runs", {})
    triggered = state.setdefault("triggered", {})
    due = judges.due_triggers(checks, triggered, runs.get(today, 0), now, CONTROL)
    if not due:
        return []
    for name in due:
        triggered[name] = now.isoformat()
    state["triggered_runs"] = {today: runs.get(today, 0) + 1}
    _save(
        TRIGGER_FILE,
        {
            "at": now.isoformat(),
            "problems": [item.as_dict() for item in checks if item.name in due],
        },
    )
    # kickstart without -k: an agent run already under way is left to finish.
    result = subprocess.run(
        ["launchctl", "kickstart", f"gui/{os.getuid()}/{AGENT_LABEL}"],
        capture_output=True,
        text=True,
        timeout=CONTROL.launch_agent_timeout_seconds,
    )
    if result.returncode:
        log.error("Could not start %s (exit %s)", AGENT_LABEL, result.returncode)
    return due
