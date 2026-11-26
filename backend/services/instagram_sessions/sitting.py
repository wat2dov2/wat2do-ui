"""A sitting: one school account's whole Instagram turn, done by a Claude session.

From the control box's start time each morning, every school account gets one sitting
a day, schools with a carousel to post first. Claude Code takes the emulator on that
account and does everything in one go (``instagram_sessions/prompt.md`` in the local prompts
folder): it posts the day's carousel,
likes and reposts it, sets its song, place and club tags, comments a GIF, shares
each event's original post to the story, posts a thank-you story when the account just
reached a follower or like milestone, then sends the claim-link follow-ups that are
due. Direct messages are otherwise not part of it: the notification agent
(``notification.py``) answers each as it arrives. A carousel
posted outside a sitting (the admin's Publish button) brings its school's sitting
forward to do the same after the post.

Claude works only through the ``ig`` command (``moves.py``), on the emulator the worker
holds for the whole sitting, on the second Claude login so a sitting never spends the
login ingestion runs on. Each move logs its own start and end, so every step of every
sitting can be traced afterwards.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from core.constants import INSTAGRAM_BATCH_PUBLISHED, INSTAGRAM_MUSIC_PENDING
from core.controlbox import controlbox
from core.database import get_sb
from core.prompts import render_prompt
from core.tables import INSTAGRAM_PUBLISH_BATCHES
from services import school_service
from services.claude_code import ClaudeCodeError, ClaudeLimited, claude_environment, run_agent
from services.instagram_accounts import school_account_username
from services.instagram_emulator.device import EmulatorDevice

log = logging.getLogger(__name__)

CONTROL = controlbox.instagram_sessions
EMULATOR = controlbox.instagram_emulator
PUBLISHING = controlbox.instagram_publishing
TORONTO = ZoneInfo("America/Toronto")
HERE = Path(__file__).parent
STATE_PATH = Path.home() / ".local/state/wat2do/instagram-sittings/sat.json"
WORKDIR_PREFIX = "wat2do-sitting-"
REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "posted": {"type": "boolean"},
        "finished": {"type": "boolean"},
        "stories": {"type": "string"},
        "claims_sent": {"type": "integer"},
        "problems": {"type": "string"},
    },
    "required": ["posted", "finished", "stories", "claims_sent", "problems"],
    "additionalProperties": False,
}


def due(now: datetime | None = None) -> list[str]:
    """Schools whose sitting is due, most urgent first: a carousel posted outside a
    sitting that still waits for its like and song, then from the start time each
    school not yet sat today, schools with a carousel ready to post first."""
    moment = (now or datetime.now(timezone.utc)).astimezone(TORONTO)
    if not EMULATOR.action_start_hour <= moment.hour < EMULATOR.action_end_hour:
        return []
    if _paused_until() > moment:
        # Claude's usage limit turned the last sitting away; every sitting waits it out.
        return []
    schools = [
        school for school in _waiting_carousels(moment) if school in EMULATOR.android_user_by_school
    ]
    if (moment.hour, moment.minute) >= (CONTROL.start_hour, CONTROL.start_minute):
        sat = set(_sat_on(moment.date()))
        ready = _ready_drafts(moment.date())
        morning = sorted(
            (school for school in EMULATOR.android_user_by_school if school not in sat),
            key=lambda school: (school not in ready, school),
        )
        schools += [school for school in morning if school not in schools]
    return schools


def run(device: EmulatorDevice, school: str, now: datetime | None = None) -> dict[str, Any] | None:
    """Give the school's turn to Claude. The worker holds the emulator on the school's
    account; the screen reader is let go so the moves can start their own."""
    moment = (now or datetime.now(timezone.utc)).astimezone(TORONTO)
    device.release_screen()
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    os.chmod(workdir, 0o700)
    try:
        report = run_agent(
            _prompt(school, moment),
            workdir=workdir,
            model=CONTROL.model,
            tools=("Bash", "Read"),
            allowed_tools=("Bash(ig:*)", "Read(./**)"),
            schema=REPORT_SCHEMA,
            timeout=CONTROL.sitting_timeout_minutes * 60,
            env=_environment(school, workdir),
        )
    except ClaudeLimited as exc:
        # Nothing was decided; every sitting waits for Claude's limit to reset.
        log.warning("Sitting for %s waits: %s", school, exc)
        _pause(moment + timedelta(minutes=CONTROL.limit_pause_minutes))
        return None
    except ClaudeCodeError as exc:
        log.error("Sitting for %s did not finish: %s", school, exc)
        report = {"problems": f"The sitting did not finish: {exc}"}
        _log_report(school, report)
        # A sitting that broke off is tried again, at most `sitting_attempts` times a day.
        if _tried(school, moment.date()) >= CONTROL.sitting_attempts:
            _mark_sat(school, moment.date())
        return report
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    _mark_sat(school, moment.date())
    _log_report(school, report)
    return report


def _environment(school: str, workdir: str) -> dict[str, str]:
    environment = claude_environment()
    environment.update(
        {
            "PATH": f"{HERE}{os.pathsep}{environment.get('PATH', '')}",
            "CLAUDE_CONFIG_DIR": os.path.expanduser(CONTROL.claude_config_dir),
            "WAT2DO_SITTING_SCHOOL": school,
            "WAT2DO_SITTING_DIR": workdir,
            # A move outlasting Claude Code's two-minute default went to the background.
            "BASH_DEFAULT_TIMEOUT_MS": str(CONTROL.move_timeout_minutes * 60_000),
            # The worker holds the emulator for the whole sitting, so moves never wait on it.
            "WAT2DO_EMULATOR_HELD": "1",
        }
    )
    return environment


def _prompt(school: str, moment: datetime) -> str:
    record = school_service.get_school(school)
    values = {
        "account": school_account_username(school),
        "school_name": record.name if record else school,
        "school_url": f"https://{school}.wat2do.io",
        "today": moment.strftime("%A, %B %-d, %Y"),
        "minimum_slides": str(PUBLISHING.minimum_event_slides),
    }
    return render_prompt("instagram_sessions/prompt.md", values)


def _waiting_carousels(moment: datetime) -> list[str]:
    """Schools with a posted carousel still waiting for its like and song, oldest first,
    each tried again only `music_retry_minutes` after its last try."""
    oldest = moment - timedelta(hours=PUBLISHING.music_max_age_hours)
    retry_after = moment - timedelta(minutes=PUBLISHING.music_retry_minutes)
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select(f"music_attempts,updated_at,published_at,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("status", INSTAGRAM_BATCH_PUBLISHED)
        .eq("music_status", INSTAGRAM_MUSIC_PENDING)
        .gte("published_at", oldest.isoformat())
        .order("published_at")
        .execute()
    ).data or []
    schools = []
    for row in rows:
        row = school_service.with_school_slug(row)
        if row["music_attempts"] and datetime.fromisoformat(row["updated_at"]) > retry_after:
            continue
        if row["school"] not in schools:
            schools.append(row["school"])
    return schools


def _ready_drafts(day: date) -> set[str]:
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select(f"id,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("local_date", day.isoformat())
        .eq("batch_kind", "events")
        .eq("status", "ready_for_review")
        .execute()
    ).data or []
    return {school_service.with_school_slug(row)["school"] for row in rows}


def _state() -> dict[str, Any]:
    try:
        state = json.loads(STATE_PATH.read_text())
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def _save(state: dict[str, Any], day: date) -> None:
    """Keep only the last week of days, and the pause."""
    keep = {(day - timedelta(days=offset)).isoformat() for offset in range(7)} | {"paused_until"}
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps({key: value for key, value in state.items() if key in keep}))


def _sat_on(day: date) -> list[str]:
    return list(_state().get(day.isoformat(), {}).get("sat", []))


def _mark_sat(school: str, day: date) -> None:
    state = _state()
    sat = state.setdefault(day.isoformat(), {}).setdefault("sat", [])
    if school not in sat:
        sat.append(school)
    _save(state, day)


def _tried(school: str, day: date) -> int:
    """Count one more sitting for the school today that broke off; the count so far."""
    state = _state()
    tries = state.setdefault(day.isoformat(), {}).setdefault("tries", {})
    tries[school] = tries.get(school, 0) + 1
    _save(state, day)
    return int(tries[school])


def _pause(until: datetime) -> None:
    state = _state()
    state["paused_until"] = until.isoformat()
    _save(state, until.astimezone(TORONTO).date())


def _paused_until() -> datetime:
    value = _state().get("paused_until")
    try:
        return datetime.fromisoformat(value) if value else datetime.min.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def _log_report(school: str, report: dict[str, Any]) -> None:
    path = STATE_PATH.parent / f"{datetime.now(TORONTO).date().isoformat()}.jsonl"
    entry = {"school": school, "sitting": report, "ended": datetime.now(timezone.utc).isoformat()}
    with path.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")
