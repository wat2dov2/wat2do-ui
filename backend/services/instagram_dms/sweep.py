"""Answer a school account's DMs from its inbox, at random times through the day.

The emulator worker visits each account and calls ``answer`` once ``due`` says the
account's randomly chosen next check has come, so each inbox is read at irregular
times like a person would. A check lists the main inbox and message requests and
answers each thread that may need it with ``EmulatorDirectExecutor``.

Local state remembers each thread's last preview that was handled, so a thread is
read again only when something new arrives, each account's next check, and the pause
a person must clear after a reply or repost that could not be confirmed. DM text is
never logged.
"""

from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services import school_service
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice
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


def due(school: str, now: datetime | None = None) -> bool:
    """Whether this account's inbox is due a check: not paused, and its random gap has passed."""
    state = _load()
    moment = (now or datetime.now().astimezone()).timestamp()
    return not state.get("paused") and moment >= state.get("next_check_at", {}).get(school, 0)


def answer(device: EmulatorDevice, school: str) -> list[str]:
    """Answer what this account's inbox needs, then schedule its next check.

    The worker has already switched the app to the account and holds the lock. A reply
    or repost that cannot be confirmed pauses every inbox until a person resumes it.
    """
    state = _load()
    record = school_service.get_school(school)
    if record is None:
        raise BrowserSessionError("School is not in the database")
    account = school_account_username(school)
    user = EMULATOR.android_user_by_school[school]
    handled: dict[str, str] = state.setdefault("handled", {}).setdefault(school, {})
    executor = EmulatorDirectExecutor(device)
    statuses = []
    # The next check is scheduled however this one ends, so one broken inbox never
    # holds the worker on its account.
    gap = random.uniform(CONTROL.sweep_gap_min_minutes, CONTROL.sweep_gap_max_minutes)
    next_check = datetime.now().astimezone() + timedelta(minutes=gap)
    state.setdefault("next_check_at", {})[school] = next_check.timestamp()
    _save(state)
    try:
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
    except BrowserEngagementUncertain as exc:
        # It may already have reached Instagram, so a person checks before anything else.
        state["paused"] = str(exc)
        _save(state)
        log.error("DM sweep paused: %s", exc)
        raise
    return statuses


def paused() -> str | None:
    return _load().get("paused")


def resume() -> None:
    """Clear a pause once a person has checked the thread and story it names."""
    state = _load()
    state.pop("paused", None)
    _save(state)


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


def _load() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except FileNotFoundError:
        return {}


def _save(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(STATE_PATH, json.dumps(state, sort_keys=True).encode())
