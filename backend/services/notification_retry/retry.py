"""Daily: log Brave back in (the first school's profile first), then rerun the failed
Process Notifications runs so their posts are ingested.

A school account that drops out of Brave fails its browser-run notification job. This
reuses the capped, saved-profile login recovery in instagram_browser (it never types a
password) and then reruns each failed run, up to a per-run and per-day cap. A run that
keeps failing after its cap is reported for a person to re-login that account by hand.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Callable

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services.notification_retry import github_runs
from services.notification_retry.github_runs import GitHubCliError

log = logging.getLogger(__name__)

STATE_DIRECTORY = Path.home() / ".local/state/wat2do/notification-retry"
_STATE_PATH = STATE_DIRECTORY / "state.json"


def _load_state() -> dict:
    try:
        state = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    runs = state.get("runs")
    state["runs"] = runs if isinstance(runs, dict) else {}
    stamps = state.get("rerun_timestamps")
    state["rerun_timestamps"] = stamps if isinstance(stamps, list) else []
    return state


def _save_state(state: dict) -> None:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    atomic_write(_STATE_PATH, json.dumps(state, sort_keys=True).encode())


def _prune(state: dict, now: float, lookback_hours: int) -> None:
    # Keep a run's history a little past the lookback so a persistent failure keeps
    # escalating instead of being retried fresh; forget the rest.
    horizon = now - max(lookback_hours * 3600, 7 * 86400)
    state["runs"] = {
        run_id: entry
        for run_id, entry in state["runs"].items()
        if float(entry.get("last_at", 0)) >= horizon
    }
    state["rerun_timestamps"] = [at for at in state["rerun_timestamps"] if now - float(at) < 86400]


def _recover_login(login_first_school: str, now: Callable[[], float]) -> bool | None:
    """Prefer one school's saved profile, then run the capped Brave relogin.

    Returns True if it logged back in, False if there was nothing to recover, and None if
    the browser stack is unavailable or a relogin hiccup kept it from running. A relogin
    problem never blocks the reruns.
    """
    try:
        from services.instagram_notifications import browser_worker
        from services.instagram_notifications.browser_queue import BrowserJobQueue
        from services.instagram_notifications.browser_session import school_account_username
    except Exception as exc:  # noqa: BLE001 - the browser stack only imports on the Mac
        log.error("Browser login recovery is unavailable: %s", exc)
        return None
    try:
        queue = BrowserJobQueue()
        queue.set_setting("retrieval_pool_account", school_account_username(login_first_school))
        return browser_worker.recover_login(queue, now=now)
    except Exception as exc:  # noqa: BLE001 - a relogin hiccup must not block the reruns
        log.error("Brave login recovery did not run: %s", exc)
        return None


def retry_failed_notifications(*, now: Callable[[], float] = time.time) -> dict:
    """One pass: recover the Brave login, then rerun failed notification runs."""
    control = controlbox.notification_retry
    result: dict = {
        "failed_runs": 0,
        "relogin": None,
        "reran": [],
        "escalated": [],
        "skipped": [],
    }
    try:
        failed = github_runs.list_failed_runs(
            control.github_repo, control.workflow_name, control.lookback_hours, now=now
        )
    except GitHubCliError as exc:
        log.error("Could not list failed notification runs: %s", exc)
        result["error"] = str(exc)
        return result

    result["failed_runs"] = len(failed)
    if not failed:
        log.info(
            "No failed %s runs in the last %sh; nothing to retry",
            control.workflow_name,
            control.lookback_hours,
        )
        return result

    # Log back in first, the login_first_school's saved profile ahead of any other. This
    # is a no-op unless Brave is actually logged out, and it never types a password.
    result["relogin"] = _recover_login(control.login_first_school, now)

    state = _load_state()
    _prune(state, now(), control.lookback_hours)
    reruns_today = len(state["rerun_timestamps"])
    for run in failed:
        entry = state["runs"].get(run.id) or {"count": 0, "last_at": 0.0}
        if int(entry["count"]) >= control.max_reruns_per_run:
            result["escalated"].append(run.id)
            log.warning(
                "Run %s (%s) still failing after %s reruns; an account likely needs a manual "
                "re-login in Brave: %s",
                run.id,
                run.title,
                entry["count"],
                run.url,
            )
            continue
        if reruns_today >= control.reruns_per_day:
            result["skipped"].append(run.id)
            continue
        try:
            github_runs.rerun_failed_jobs(control.github_repo, run.id)
        except GitHubCliError as exc:
            result["skipped"].append(run.id)
            log.error("Could not rerun %s: %s", run.id, exc)
            continue
        entry["count"] = int(entry["count"]) + 1
        entry["last_at"] = now()
        state["runs"][run.id] = entry
        state["rerun_timestamps"].append(now())
        reruns_today += 1
        result["reran"].append(run.id)
        log.info("Reran %s (%s)", run.id, run.title)

    _save_state(state)
    log.info(
        "Notification retry: %s failed, %s reran, %s need a person, %s skipped (relogin=%s)",
        result["failed_runs"],
        len(result["reran"]),
        len(result["escalated"]),
        len(result["skipped"]),
        result["relogin"],
    )
    return result
