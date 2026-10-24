"""Answer every school account's DMs from its inbox, at random times through the day.

A LaunchAgent wakes ``run_if_due`` often; it sweeps only once the randomly chosen
next run time has passed, and only during waking hours, so the accounts check their
messages at irregular times like a person would. A sweep visits each account in
turn, lists its main inbox and message requests, and answers each thread that may
need it with ``EmulatorDirectExecutor``. The emulator's lock is held per account, so
other emulator jobs can run between accounts.

Local state remembers each thread's last preview that was handled, so a thread is
read again only when something new arrives, and holds the pause a person must clear
after a reply or repost that could not be confirmed. DM text is never logged.
"""

from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timedelta
from itertools import groupby
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services import school_service
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, exclusive
from services.instagram_emulator.direct import EmulatorDirectExecutor
from services.instagram_emulator.inbox import InboxRow, read_inbox
from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserSessionError,
    school_account_username,
)

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_dms
STATE_PATH = Path.home() / ".local/state/wat2do/instagram-dms/sweep.json"


def run_if_due() -> dict[str, Any]:
    """Sweep when the scheduled time has come; otherwise say when it will."""
    state = _load()
    if state.get("paused"):
        return {"status": "paused", "reason": state["paused"]}
    now = datetime.now().astimezone()
    if now.timestamp() < state.get("next_run_at", 0):
        return {"status": "waiting", "next_run_at": state["next_run_at"]}
    if not _waking_hours(now):
        state["next_run_at"] = _next_run(now).timestamp()
        _save(state)
        return {"status": "waiting", "next_run_at": state["next_run_at"]}
    return sweep(state)


def sweep(state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Visit every school account once and answer what needs it."""
    state = _load() if state is None else state
    executor = EmulatorDirectExecutor()
    device = EmulatorDevice()
    totals: dict[str, int] = {}
    failed: list[str] = []
    try:
        for school in _schools_in_visit_order():
            try:
                for status in _sweep_account(school, state, executor, device):
                    totals[status] = totals.get(status, 0) + 1
            except BrowserEngagementUncertain:
                raise
            except (BrowserSessionError, EmulatorError) as exc:
                log.warning("DM sweep skipped %s: %s", school, exc)
                failed.append(school)
    except BrowserEngagementUncertain as exc:
        # It may already have reached Instagram, so a person checks before anything else.
        state["paused"] = str(exc)
        _save(state)
        log.error("DM sweep paused: %s", exc)
        return {"status": "paused", "reason": str(exc), **totals, "failed": failed}
    state["next_run_at"] = _next_run(datetime.now().astimezone()).timestamp()
    _save(state)
    return {"status": "swept", **totals, "failed": failed}


def resume() -> None:
    """Clear a pause once a person has checked the thread and story it names."""
    state = _load()
    state.pop("paused", None)
    _save(state)


def _sweep_account(
    school: str, state: dict[str, Any], executor: EmulatorDirectExecutor, device: EmulatorDevice
) -> list[str]:
    record = school_service.get_school(school)
    if record is None:
        raise BrowserSessionError("School is not in the database")
    account = school_account_username(school)
    user = EMULATOR.android_user_by_school[school]
    handled: dict[str, str] = state.setdefault("handled", {}).setdefault(school, {})
    statuses = []
    with exclusive():
        device.wake()
        device.use_android_user(user)
        device.use_account(user, account)
        for row in _threads(device, user):
            if not _needs_answer(row, handled):
                continue
            result = executor.handle(
                row,
                account_username=account,
                school=school,
                school_name=record.name,
                dry_run=CONTROL.dry_run,
            )
            handled[row.name] = row.preview
            _save(state)
            statuses.append(result["status"])
            log.info("DM sweep %s: %s (%s)", school, result["status"], result["outcome"])
    return statuses


def _threads(device: EmulatorDevice, user: int) -> list[InboxRow]:
    """Every listed thread once; the inbox's "All" tab also shows message requests,
    so a request's own row wins, as it is the one that needs accepting."""
    threads = {row.name: row for row in read_inbox(device, user, requests=False)}
    threads.update({row.name: row for row in read_inbox(device, user, requests=True)})
    return list(threads.values())


def _needs_answer(row: InboxRow, handled: dict[str, str]) -> bool:
    """An unread thread with a message not handled yet, or a read thread never handled.

    A read thread often shows who is active instead of its latest message, so it is
    opened once to see; after that only a new message (which makes it unread) brings
    it back. The reader checks the thread's own dates when the row shows no age.
    """
    if row.age_days is not None and row.age_days > CONTROL.max_thread_age_days:
        return False
    if row.unread:
        return handled.get(row.name) != row.preview
    return row.name not in handled and not row.ours


def _schools_in_visit_order() -> list[str]:
    """Accounts grouped by Android user, since switching users is slow; otherwise shuffled."""
    schools = list(EMULATOR.android_user_by_school)
    random.shuffle(schools)
    schools.sort(key=EMULATOR.android_user_by_school.__getitem__)
    groups = [list(group) for _user, group in groupby(schools, EMULATOR.android_user_by_school.get)]
    random.shuffle(groups)
    return [school for group in groups for school in group]


def _waking_hours(moment: datetime) -> bool:
    return CONTROL.sweep_start_hour <= moment.hour < CONTROL.sweep_end_hour


def _next_run(after: datetime) -> datetime:
    """A random gap later, moved into the next morning's waking hours when it falls outside."""
    gap = random.uniform(CONTROL.sweep_gap_min_minutes, CONTROL.sweep_gap_max_minutes)
    candidate = after + timedelta(minutes=gap)
    if _waking_hours(candidate):
        return candidate
    morning = candidate.replace(hour=CONTROL.sweep_start_hour, minute=0, second=0, microsecond=0)
    if morning <= candidate:
        morning += timedelta(days=1)
    return morning + timedelta(minutes=random.uniform(0, CONTROL.sweep_gap_min_minutes))


def _load() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except FileNotFoundError:
        return {}


def _save(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(STATE_PATH, json.dumps(state, sort_keys=True).encode())
