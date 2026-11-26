"""The notification agent: one Instagram notification, handled by a Claude session.

The Mac's notification recorder dispatches each new direct message, message request,
story mention and comment to the "Handle notification" workflow with only its category,
school account, sender's name and time. The workflow's job on the Mac runs ``handle``:
it takes the emulator (waiting its turn behind the worker), switches the app to the
account and gives the notification to Claude Code with its prompt, read afresh for
each run from the Mac's local prompts folder (``instagram_sessions/notification_prompt.md``,
``core/prompts.py``; prompts never live in the repository).
Claude reads the thread on the emulator itself through the ``ig`` command
(``moves.py``), decides, and acts; nothing it reads ever leaves the Mac. Each run's full
report stays in ``~/.local/state/wat2do/notification-agent/<date>.jsonl``; what the job
prints is only the case and the moves made.

``controlbox/instagram_dms.json`` ``agent_enabled`` is the kill switch, and while
``agent_schools`` names schools only their accounts are handled. A challenge, an action
limit or a login screen pauses one account (``pause``) for ``challenge_pause_hours``.
``dry_run`` runs the same prompt over a recorded thread, with moves that only say what
they would do.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from core.prompts import render_prompt
from services import school_service
from services.claude_code import claude_environment, run_agent
from services.instagram_accounts import android_user, school_account_username, school_for_account
from services.instagram_emulator.device import EmulatorDevice, exclusive

SESSIONS = controlbox.instagram_sessions
DMS = controlbox.instagram_dms
EMULATOR = controlbox.instagram_emulator
TORONTO = ZoneInfo("America/Toronto")
HERE = Path(__file__).parent
STATE_DIR = Path.home() / ".local/state/wat2do/notification-agent"
_PAUSED = STATE_DIR / "paused.json"
_WAITING = STATE_DIR / "waiting"
WORKDIR_PREFIX = "wat2do-notification-"
# Set for the moves of a dry run: the recorded thread they read instead of the emulator.
DRY_RUN = "WAT2DO_NOTIFICATION_DRY_RUN"
# Set for the moves of every notification run, which never send a claim message (the
# daily sitting follows up with those).
RUN = "WAT2DO_NOTIFICATION_RUN"
CASES = (*"ABCDEFGHIJK", "post", "mention", "comment", "none")
REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "case": {"type": "string", "enum": list(CASES)},
        "actions": {"type": "array", "items": {"type": "string"}},
        "replied": {"type": "string"},
        "problems": {"type": "string"},
    },
    "required": ["case", "actions", "replied", "problems"],
    "additionalProperties": False,
}
_ACCOUNT = re.compile(r"^[a-z0-9._]{1,30}$")
_CATEGORY = re.compile(r"^[a-z0-9_]{2,60}$")
# A sender's name is a stranger's display name: it reaches Claude only quoted, with
# nothing that could close the quote or start a shell expansion.
_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f\"`$\\]")
_SENDER_MAX = 80
_MOVE = re.compile(r"^\s*ig\s+([a-z-]+)")


class NotificationError(ValueError):
    """The dispatch did not carry a notification the agent can handle."""


@dataclass(frozen=True)
class Notification:
    category: str
    account: str
    sender: str
    received_at: str

    @classmethod
    def parse(cls, payload: object) -> Notification:
        if not isinstance(payload, dict):
            raise NotificationError("The dispatch carried no notification")
        category = str(payload.get("category") or "")
        account = str(payload.get("account") or "")
        if not _CATEGORY.match(category) or not _ACCOUNT.match(account):
            raise NotificationError("The notification's category or account is not valid")
        sender = _UNSAFE_NAME.sub("", str(payload.get("sender") or "")).strip()[:_SENDER_MAX]
        return cls(category, account, sender, str(payload.get("received_at") or "")[:40])

    @property
    def school(self) -> str:
        """The school whose account got it (a hidden test school's too), or ""."""
        return school_for_account(self.account) or ""


def handle(notification: Notification, *, now: datetime | None = None) -> dict[str, Any]:
    """Handle one notification on the emulator; what the workflow's log may show.

    Raises when the run could not happen (the emulator, the switch or Claude Code
    failed), so the workflow run fails and is reran later.
    """
    moment = (now or datetime.now(timezone.utc)).astimezone(TORONTO)
    skipped = _skipped(notification)
    if skipped:
        return {"handled": False, "why": skipped}
    school = notification.school
    with _waiting(), exclusive():
        device = EmulatorDevice()
        device.wake()
        user = android_user(school)
        device.use_android_user(user)
        device.use_account(user, school_account_username(school))
        # Each move starts its own screen reader; only one may be connected at a time.
        device.release_screen()
        report = _run(notification, moment, {"WAT2DO_EMULATOR_HELD": "1"})
    _keep(notification, report, moment)
    return public(report)


def dry_run(notification: Notification, recording: dict[str, Any]) -> dict[str, Any]:
    """Run the prompt over a recorded thread (``thread``, ``messages``, ``inbox``): the
    moves only say what they would do, and nothing touches the emulator or the
    database. Returns the full report with the moves made."""
    moment = datetime.now(TORONTO)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(recording, handle)
    try:
        report = _run(notification, moment, {DRY_RUN: handle.name})
        report["done"] = json.loads(Path(handle.name).read_text()).get("done", [])
    finally:
        os.unlink(handle.name)
    return report


def public(report: dict[str, Any]) -> dict[str, Any]:
    """What may be printed in the public workflow log: the case and the move names,
    never a reply's text, a thread's name or a sender."""
    moves = [match.group(1) for action in report["actions"] if (match := _MOVE.match(action))]
    return {
        "handled": True,
        "case": report["case"],
        "moves": moves,
        "replied": bool(report["replied"]),
        "problems": bool(report["problems"]),
    }


def _skipped(notification: Notification) -> str:
    if not DMS.agent_enabled:
        return "notification handling is turned off (instagram_dms.json agent_enabled)"
    if not notification.school:
        return "no school's emulator account has this name"
    if DMS.agent_schools and notification.school not in DMS.agent_schools:
        return "this school is not in the rollout yet (instagram_dms.json agent_schools)"
    paused = paused_until(notification.school)
    if paused is not None:
        return f"this account rests until {paused} after an Instagram challenge"
    if not notification.sender:
        return "the notification names no sender"
    return ""


def _run(notification: Notification, moment: datetime, extra: dict[str, str]) -> dict[str, Any]:
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    os.chmod(workdir, 0o700)
    environment = claude_environment()
    environment.update(
        {
            "PATH": f"{HERE}{os.pathsep}{environment.get('PATH', '')}",
            "CLAUDE_CONFIG_DIR": os.path.expanduser(SESSIONS.claude_config_dir),
            "WAT2DO_SITTING_SCHOOL": notification.school,
            "WAT2DO_SITTING_DIR": workdir,
            RUN: "1",
            **extra,
        }
    )
    try:
        return run_agent(
            prompt(notification, moment),
            workdir=workdir,
            model=SESSIONS.model,
            tools=("Bash", "Read"),
            allowed_tools=("Bash(ig:*)", "Read(./**)"),
            schema=REPORT_SCHEMA,
            timeout=SESSIONS.notification_timeout_minutes * 60,
            env=environment,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def prompt(notification: Notification, moment: datetime) -> str:
    record = school_service.get_school(notification.school)
    values = {
        "account": notification.account,
        "school_name": record.name if record else notification.school,
        "school_url": f"https://{notification.school}.wat2do.io",
        "today": moment.strftime("%A, %B %-d, %Y"),
        "category": notification.category,
        "sender": notification.sender,
        "received_at": notification.received_at,
        "contact_email": DMS.contact_email,
        "reply_max_characters": str(DMS.reply_max_characters),
    }
    return render_prompt("instagram_sessions/notification_prompt.md", values)


def _keep(notification: Notification, report: dict[str, Any], moment: datetime) -> None:
    """The full report, reply text included, stays on the Mac only."""
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = STATE_DIR / f"{moment.date().isoformat()}.jsonl"
    entry = {
        "school": notification.school,
        "category": notification.category,
        "sender": notification.sender,
        "received_at": notification.received_at,
        "report": report,
        "ended": datetime.now(timezone.utc).isoformat(),
    }
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "a") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def pause(school: str, shown: str, *, now: datetime | None = None) -> None:
    """Rest the account's notification handling after Instagram showed ``shown``."""
    until = (now or datetime.now(timezone.utc)) + timedelta(hours=DMS.challenge_pause_hours)
    paused = _paused()
    paused[school] = {"until": until.isoformat(), "shown": shown[:120]}
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(_PAUSED, json.dumps(paused, sort_keys=True).encode())


def paused_until(school: str, *, now: datetime | None = None) -> str | None:
    """When the account's rest ends, or None when it is not resting."""
    entry = _paused().get(school)
    if not isinstance(entry, dict):
        return None
    try:
        until = datetime.fromisoformat(str(entry.get("until")))
    except ValueError:
        return None
    return until.isoformat() if until > (now or datetime.now(timezone.utc)) else None


def _paused() -> dict[str, Any]:
    try:
        paused = json.loads(_PAUSED.read_text())
    except (OSError, ValueError):
        return {}
    return paused if isinstance(paused, dict) else {}


@contextmanager
def _waiting() -> Iterator[None]:
    """Say a run waits for the emulator, so the worker stops its follows between
    profiles for it (``waiting``)."""
    _WAITING.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = _WAITING / str(os.getpid())
    marker.touch()
    try:
        yield
    finally:
        marker.unlink(missing_ok=True)


def waiting() -> bool:
    """Whether a notification run waits for the emulator (or has it)."""
    for marker in _WAITING.glob("*") if _WAITING.exists() else ():
        try:
            os.kill(int(marker.name), 0)
        except (ValueError, ProcessLookupError):
            marker.unlink(missing_ok=True)
            continue
        except PermissionError:
            pass
        return True
    return False
