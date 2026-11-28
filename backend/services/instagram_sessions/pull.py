"""The notification pull: reading a school account's DMs, message requests and comments
on the emulator when Instagram stopped pushing it notifications.

Instagram's servers sometimes stop pushing to an account on the emulator for days while
the phone side is fine (wat2do.berkeley had none from 2026-11-18, wat2do.mit and
wat2do.brocku from 11-26, 41 gaps of 30 to 120 h across the accounts since 11-10). Its
posts are still read by the quiet-school lane, but nobody reads its DMs, requests, story
mentions or comments, since the notification agent only starts on a push. So every run
(``jobs/pull_instagram_notifications.py``, ``controlbox/notification_pull.json``) takes each
school account the recorder has heard nothing from for ``silence_hours``, holds the
emulator for that one account, switches to it and runs the ``ig inbox`` and ``ig comments``
moves. Each unread thread and request, and each new comment on our newest posts, is
then sent to the notification agent as the same ``instagram_interaction`` dispatch the
recorder sends for a push (``notification_dispatch.agent_payload``), so it goes through
the "Handle notification" workflow, one run at a time on the emulator's runner, and is
reran like any other when it fails.

Only the unread flag says a thread is new: ``ours_last`` and ``age_days`` are unreliable
on threads already read. A thread is not dispatched again while an earlier dispatch is on
its way or within ``thread_repeat_hours`` of the pull, the agent (its reports) or a move
(the sittings' step log) last touching it; a comment is dispatched once. Accounts the
agent would skip (its kill switch and rollout, French schools, an account resting after a
challenge) and accounts whose account-guard breaker is open are never read, nor are
hidden schools, which are not in ``android_user_by_school``. A challenge or login screen
rests the account like any move would and stops the run. Each account considered gets
one line of counts in ``~/.local/state/wat2do/notification-pull/<date>.jsonl``; thread
names and authors stay in the owner-only ``state.json`` beside it, never a message's text.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services import notification_recording
from services.instagram_accounts import android_user, is_wat2do_account, school_account_username
from services.instagram_emulator import logins
from services.instagram_emulator.device import (
    EMULATOR_HELD,
    AccountChallenged,
    EmulatorDevice,
    EmulatorError,
    exclusive,
)
from services.instagram_sessions import notification
from services.notification_dispatch import DispatchError, agent_payload, dispatch

log = logging.getLogger(__name__)
CONTROL = controlbox.notification_pull
TORONTO = ZoneInfo("America/Toronto")
STATE_DIR = Path.home() / ".local/state/wat2do/notification-pull"
_STATE = STATE_DIR / "state.json"
SITTING_LOG = Path.home() / ".local/state/wat2do/instagram-sittings"
BACKEND_DIR = Path(__file__).resolve().parents[2]
# The push categories a pushed message, request and comment carry.
MESSAGE = "direct_v2_text"
REQUEST = "direct_v2_pending"
COMMENT = "comment"


class Challenged(RuntimeError):
    """Instagram showed a challenge or its login screen: the run stops for a person."""


class MoveFailed(RuntimeError):
    """An ``ig`` move answered with an error."""


def run(*, schools: Iterable[str] = (), now: datetime | None = None) -> list[dict[str, Any]]:
    """One pull over every school account, or only ``schools`` (read even when heard
    lately); returns the line logged for each account."""
    moment = now or datetime.now(timezone.utc)
    only = set(schools)
    state = _load_state()
    heard = notification_recording.read_recorded().by_account
    lines: list[dict[str, Any]] = []
    due: list[dict[str, Any]] = []
    for school in sorted(controlbox.instagram_emulator.android_user_by_school):
        if only and school not in only:
            continue
        account = school_account_username(school)
        last = heard.get(account)
        hours = None if last is None else (moment - last).total_seconds() / 3600
        line: dict[str, Any] = {
            "school": school,
            "silent_hours": None if hours is None else round(hours, 1),
        }
        why = _not_read(school, account, hours, asked=bool(only))
        if why:
            lines.append({**line, "outcome": "skipped", "why": why})
        else:
            due.append(line)
    due.sort(key=lambda line: state["pulled"].get(line["school"], ""))
    stopped = ""
    for index, line in enumerate(due):
        if stopped or index >= CONTROL.accounts_per_run:
            why = stopped or "over accounts_per_run; read first next run"
            lines.append({**line, "outcome": "skipped", "why": why})
            continue
        lines.append(_pull_account(line, state, moment))
        if lines[-1]["outcome"] == "challenge":
            stopped = "the run stopped at a challenge"
    _keep(lines, moment)
    return lines


def _not_read(school: str, account: str, hours: float | None, *, asked: bool) -> str:
    """Why the account is not read this run, or "" when it is."""
    skipped = notification.school_skipped(school)
    if skipped:
        return skipped
    if not asked and hours is not None and hours < CONTROL.silence_hours:
        return "heard lately"
    try:
        tripped = logins.breaker(account)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return f"its account guard could not be read ({type(exc).__name__})"
    return "its account-guard breaker is open" if tripped else ""


def _pull_account(line: dict[str, Any], state: dict[str, Any], moment: datetime) -> dict[str, Any]:
    school = line["school"]
    account = school_account_username(school)
    started = time.monotonic()
    try:
        threads, posts = _read(school, account)
    except Challenged:
        return {**line, "outcome": "challenge", "seconds": round(time.monotonic() - started)}
    except (EmulatorError, MoveFailed, subprocess.SubprocessError, ValueError) as exc:
        log.warning("Could not read %s (%s)", account, type(exc).__name__)
        return {
            **line,
            "outcome": "failed",
            "why": type(exc).__name__,
            "seconds": round(time.monotonic() - started),
        }
    state["pulled"][school] = moment.isoformat()
    found = _due(school, threads, posts or [], state, moment)
    sent, failed = _send(account, found["dispatch"], state, school, moment)
    _save_state(state, moment)
    return {
        **line,
        "outcome": "read",
        "threads": len(threads),
        "unread": sum(1 for thread in threads if thread.get("unread")),
        "requests": sum(1 for thread in threads if thread.get("request")),
        "comments": None
        if posts is None
        else sum(len(post.get("comments") or ()) for post in posts),
        "already_handled": found["already_handled"],
        "dispatched": sent,
        "dispatch_failed": failed,
        "left_for_next_run": found["left"],
        "seconds": round(time.monotonic() - started),
    }


def _read(school: str, account: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
    """The account's inbox threads and its newest posts' comments (None when they could
    not be read: a post that will not open never hides the DMs), read in one hold of the
    emulator (the worker stops its follows between profiles for it)."""
    with notification.waiting_for_emulator(), exclusive():
        device = EmulatorDevice()
        device.wake()
        user = android_user(school)
        device.use_android_user(user)
        try:
            device.use_account(user, account)
        except AccountChallenged as exc:
            notification.pause(school, "a checkpoint")
            raise Challenged(account) from exc
        _stop_at_a_challenge(device, school)
        # Each move starts its own screen reader; only one may be connected at a time.
        device.release_screen()
        threads = _move(school, "inbox")["threads"]
        posts: list[dict[str, Any]] | None
        try:
            posts = _move(school, "comments")["posts"]
        except MoveFailed:
            # 2026-11-28: berkeley's newest post would not open, and its DMs went unread.
            log.warning("Could not read the comments of %s", account)
            posts = None
        _stop_at_a_challenge(device, school)
    return threads, posts


def _stop_at_a_challenge(device: EmulatorDevice, school: str) -> None:
    shown = device.challenge()
    if shown is not None:
        notification.pause(school, shown)
        raise Challenged(school)


def _move(school: str, move: str) -> dict[str, Any]:
    """Run one ``ig`` move for the school under this process's hold of the emulator."""
    completed = subprocess.run(
        [sys.executable, "-m", "services.instagram_sessions.moves", move],
        cwd=BACKEND_DIR,
        env={**os.environ, "WAT2DO_SITTING_SCHOOL": school, EMULATOR_HELD: "1"},
        capture_output=True,
        text=True,
        timeout=controlbox.instagram_sessions.move_timeout_minutes * 60,
        check=False,
    )
    lines = [text for text in completed.stdout.splitlines() if text.strip()]
    answer = json.loads(lines[-1]) if lines else {}
    if completed.returncode or not isinstance(answer, dict) or "error" in answer:
        raise MoveFailed(f"ig {move} failed (exit {completed.returncode})")
    return answer


def _due(
    school: str,
    threads: list[dict[str, Any]],
    posts: list[dict[str, Any]],
    state: dict[str, Any],
    moment: datetime,
) -> dict[str, Any]:
    """What to dispatch: (category, sender, keys) per unread thread or request, then per
    author of new comments, at most ``dispatches_per_account``."""
    handled = _handled(school, moment)
    dispatched = state["threads"].setdefault(school, {})
    remembered = state["comments"].setdefault(school, {})
    found: list[tuple[str, str, tuple[str, ...]]] = []
    already = 0
    for thread in threads:
        if not thread.get("unread") or not thread.get("name"):
            continue
        name = str(thread["name"])
        if _on_its_way(_stamp(dispatched.get(name)), handled["threads"].get(name), moment):
            already += 1
            continue
        found.append((REQUEST if thread.get("request") else MESSAGE, name, (name,)))
    by_author: dict[str, list[str]] = {}
    for post in posts:
        for comment in post.get("comments") or ():
            author = str(comment.get("author") or "")
            if not author or is_wat2do_account(author) or comment.get("liked"):
                continue
            if comment.get("pinned"):
                continue
            key = f"{post.get('post')} {author}"
            if key in remembered or author in handled["comments"]:
                already += 1
                continue
            by_author.setdefault(author, []).append(key)
    found.extend((COMMENT, author, tuple(keys)) for author, keys in by_author.items())
    cap = CONTROL.dispatches_per_account
    return {"dispatch": found[:cap], "already_handled": already, "left": max(0, len(found) - cap)}


def _on_its_way(dispatched: datetime | None, handled: datetime | None, moment: datetime) -> bool:
    """Whether an unread thread is already taken care of: dispatched or handled within
    ``thread_repeat_hours``, or dispatched within ``pending_hours`` and not handled since."""
    repeat = timedelta(hours=CONTROL.thread_repeat_hours)
    if any(stamp is not None and moment - stamp < repeat for stamp in (dispatched, handled)):
        return True
    return (
        dispatched is not None
        and moment - dispatched < timedelta(hours=CONTROL.pending_hours)
        and (handled is None or handled < dispatched)
    )


def _handled(school: str, moment: datetime) -> dict[str, dict[str, datetime]]:
    """When the agent's reports and the sittings' step log last named each thread, and
    the comment authors the agent handled, for this school."""
    threads: dict[str, datetime] = {}
    comments: dict[str, datetime] = {}
    since = moment - timedelta(days=CONTROL.comment_remember_days)
    for entry in _entries(notification.STATE_DIR, since):
        if entry.get("school") != school or not entry.get("sender"):
            continue
        ended = _stamp(entry.get("ended"))
        if ended is None:
            continue
        handled = comments if entry.get("category") == COMMENT else threads
        name = str(entry["sender"])
        handled[name] = max(ended, handled.get(name, ended))
    pending_since = moment - timedelta(hours=CONTROL.pending_hours)
    for entry in _entries(SITTING_LOG, pending_since):
        ended = _stamp(entry.get("ended"))
        if entry.get("school") != school or not entry.get("thread") or ended is None:
            continue
        name = str(entry["thread"])
        threads[name] = max(ended, threads.get(name, ended))
    return {"threads": threads, "comments": comments}


def _entries(directory: Path, since: datetime) -> Iterable[dict[str, Any]]:
    """The entries of the day files (``<date>.jsonl``, Toronto dates) from ``since`` on."""
    first = since.astimezone(TORONTO).date() - timedelta(days=1)
    for path in sorted(directory.glob("*.jsonl")) if directory.exists() else ():
        try:
            if datetime.fromisoformat(path.stem).date() < first:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            continue
        for raw in text.splitlines():
            try:
                entry = json.loads(raw)
            except ValueError:
                continue
            if isinstance(entry, dict):
                yield entry


def _send(
    account: str,
    found: list[tuple[str, str, tuple[str, ...]]],
    state: dict[str, Any],
    school: str,
    moment: datetime,
) -> tuple[int, int]:
    """Dispatch each, ``send_spacing_seconds`` apart; a failure leaves the rest for the
    next run. Returns how many went out and how many failed."""
    sent = 0
    for index, (category, sender, keys) in enumerate(found):
        if index:
            time.sleep(controlbox.notification_recording.send_spacing_seconds)
        try:
            dispatch(agent_payload(category, account, sender, moment))
        except DispatchError as exc:
            log.warning("Could not dispatch a %s for %s (%s)", category, account, exc)
            return sent, len(found) - sent
        remembered = state["comments" if category == COMMENT else "threads"][school]
        for key in keys:
            remembered[key] = moment.isoformat()
        sent += 1
    return sent, 0


def _stamp(value: object) -> datetime | None:
    try:
        stamp = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return stamp if stamp.tzinfo is not None else None


def _load_state() -> dict[str, Any]:
    try:
        state = json.loads(_STATE.read_text())
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    return {
        key: state[key] if isinstance(state.get(key), dict) else {}
        for key in ("pulled", "threads", "comments")
    }


def _save_state(state: dict[str, Any], moment: datetime) -> None:
    """Saved owner-only (it names threads), forgetting what no rule looks at any more."""
    horizons = {
        "threads": moment - timedelta(hours=CONTROL.pending_hours),
        "comments": moment - timedelta(days=CONTROL.comment_remember_days),
    }
    for kind, horizon in horizons.items():
        for school, seen in list(state[kind].items()):
            kept = {
                key: at for key, at in seen.items() if (stamp := _stamp(at)) and stamp >= horizon
            }
            state[kind][school] = kept
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(_STATE, json.dumps(state, sort_keys=True, ensure_ascii=False).encode())


def _keep(lines: list[dict[str, Any]], moment: datetime) -> None:
    """One line of counts per account, never a thread's name or a message's text."""
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = STATE_DIR / f"{moment.astimezone(TORONTO).date().isoformat()}.jsonl"
    at = moment.isoformat(timespec="seconds")
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "a") as handle:
        for line in lines:
            handle.write(json.dumps({"at": at, **line}) + "\n")
