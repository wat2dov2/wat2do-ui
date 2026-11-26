"""The maintenance agent: every day at `agent_hour` (and early when the watchdog sees
red) one Claude Code session checks the whole Mac setup, fixes what it can and writes
a short report, naming at its top only what needs a person's hands.

Its prompt lives only in the Mac's prompts folder (`maintenance/prompt.md`). It runs
on the second Claude login, never the one ingestion uses.
"""

from __future__ import annotations

import fcntl
import html
import json
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.launch_agents import CLAUDE_CODE_PATH
from core.prompts import render_prompt
from services.claude_code import ClaudeCodeError, ClaudeLimited, claude_environment, run_agent
from services.maintenance import readings, watchdog

log = logging.getLogger(__name__)

CONTROL = watchdog.CONTROL
AGENT_LOG = watchdog.STATE_DIR / "agent.jsonl"
WORKDIR_PREFIX = "wat2do-maintenance-"
MEMORY_DIR = Path.home() / ".claude/projects/-Users-tonyqiu/memory"
RUNTIME_DIR = Path.home() / "wat2do-runtime"
REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["green", "yellow", "red"]},
        "summary": {"type": "string"},
        "fixed": {"type": "array", "items": {"type": "string"}},
        "open_problems": {"type": "array", "items": {"type": "string"}},
        "needs_tony": {"type": "array", "items": {"type": "string"}},
        "report_path": {"type": "string"},
    },
    "required": ["status", "summary", "fixed", "open_problems", "needs_tony", "report_path"],
    "additionalProperties": False,
}


def report_path(moment: datetime, *, dry_run: bool) -> Path:
    folder = Path(os.path.expanduser(CONTROL.report_dir))
    suffix = "-dry-run" if dry_run else ""
    return folder / f"health-{moment.date().isoformat()}{suffix}.html"


def run(*, dry_run: bool) -> dict[str, Any]:
    """One maintenance pass; a second one started meanwhile is skipped."""
    watchdog.STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (watchdog.STATE_DIR / "agent.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"skipped": "another maintenance run is under way"}
        return _run_locked(dry_run=dry_run)


def _take_trigger(*, dry_run: bool) -> dict[str, Any] | None:
    try:
        trigger = json.loads(watchdog.TRIGGER_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not dry_run:
        watchdog.TRIGGER_FILE.unlink(missing_ok=True)
    return trigger


def _run_locked(*, dry_run: bool) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    local = started.astimezone(readings.TORONTO)
    trigger = _take_trigger(dry_run=dry_run)
    checks = watchdog.check(trigger=False)
    path = report_path(local, dry_run=dry_run)
    path.parent.mkdir(parents=True, exist_ok=True)
    values = {
        "mode": "DRY RUN" if dry_run else "LIVE",
        "reason": "the watchdog saw red" if trigger else "the daily run",
        "now": local.strftime("%A, %B %-d, %Y, %H:%M %Z"),
        "report_path": str(path),
        "watchdog_json": json.dumps(checks, indent=1, sort_keys=True),
        "trigger_json": json.dumps(trigger, indent=1, sort_keys=True) if trigger else "none",
        "watchdog_log": str(watchdog.WATCHDOG_LOG),
        "agent_log": str(AGENT_LOG),
        "memory_dir": str(MEMORY_DIR),
        "runtime_dir": str(RUNTIME_DIR),
    }
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    os.chmod(workdir, 0o700)
    tools = ("Bash", "Read", "Glob", "Grep", "Write") + (() if dry_run else ("Edit",))
    try:
        answer = run_agent(
            render_prompt("maintenance/prompt.md", values),
            workdir=workdir,
            model=CONTROL.model,
            tools=tools,
            allowed_tools=tools,
            schema=REPORT_SCHEMA,
            timeout=CONTROL.agent_timeout_minutes * 60,
            env=_environment(dry_run=dry_run),
        )
    except ClaudeCodeError as error:
        limited = isinstance(error, ClaudeLimited)
        log.error("The maintenance agent did not finish: %s", error)
        answer = {
            "status": "red",
            "summary": f"The maintenance agent did not finish: {error}",
            "fixed": [],
            "open_problems": [
                item["summary"] for item in checks["checks"] if item["status"] == "red"
            ],
            "needs_tony": [
                "The second Claude login is at its usage limit; nothing to do unless it stays limited past its reset."
                if limited
                else "The maintenance agent failed; see the watchdog numbers below."
            ],
            "report_path": str(path),
            "error_detail": error.detail[-2000:],
        }
        _write_fallback_report(path, answer, checks)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    entry = {
        "started": started.isoformat(),
        "ended": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "reason": values["reason"],
        **answer,
    }
    with AGENT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def _environment(*, dry_run: bool) -> dict[str, str]:
    environment = claude_environment()
    sdk = Path(os.environ.get("ANDROID_HOME") or Path.home() / "Library/Android/sdk")
    environment.update(
        {
            "PATH": f"{Path.home() / '.cargo/bin'}:{CLAUDE_CODE_PATH}:{sdk / 'platform-tools'}",
            "ANDROID_HOME": str(sdk),
            "CLAUDE_CONFIG_DIR": os.path.expanduser(CONTROL.claude_config_dir),
            "BASH_DEFAULT_TIMEOUT_MS": str(CONTROL.move_timeout_minutes * 60_000),
            "BASH_MAX_TIMEOUT_MS": str(CONTROL.move_timeout_minutes * 60_000),
            "WAT2DO_MAINTENANCE_DRY_RUN": "1" if dry_run else "0",
        }
    )
    return environment


def _write_fallback_report(path: Path, answer: dict[str, Any], checks: dict[str, Any]) -> None:
    """When the agent itself fails, the day still gets a report with the raw numbers."""
    rows = "".join(
        f"<tr><td>{html.escape(item['name'])}</td><td>{html.escape(item['status'])}</td>"
        f"<td>{html.escape(item['summary'])}</td></tr>"
        for item in checks["checks"]
    )
    needs = "".join(f"<li>{html.escape(item)}</li>" for item in answer["needs_tony"])
    path.write_text(
        "<!doctype html><meta charset=utf-8><title>wat2do health</title>"
        "<style>body{font:15px system-ui;margin:24px;max-width:900px}td{padding:4px 8px;"
        "border-bottom:1px solid #ddd;vertical-align:top}</style>"
        f"<h1>wat2do health: {html.escape(answer['status'])}</h1>"
        f"<p><b>For Tony:</b></p><ul>{needs}</ul>"
        f"<p>{html.escape(answer['summary'])}</p>"
        f"<h2>Watchdog at {html.escape(checks['at'])}</h2><table>{rows}</table>",
        encoding="utf-8",
    )
