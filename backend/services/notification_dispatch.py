"""Start the "Handle notification" workflow for the notifications the Mac's emulator gets.

The recorder (``services/notification_recording.py``) hands over each new notification.
One whose Instagram push category is in ``controlbox/notification_recording.json``
``dispatch_push_categories`` (posts and daily digests) is sent whole as the
``new_instagram_post`` repository dispatch the phones' Automate flow sends. It does not
check whether a phone sent the same notification: the workflow already records each
recipient and push ID once. One in ``agent_push_categories`` (direct messages, message
requests, story mentions, comments) is sent as an ``instagram_interaction`` dispatch for
the workflow's notification agent, carrying only its category, school account, the
sender's name and its time, never its text.

A notification is sent once per intended recipient and push ID. One that cannot be sent
waits in ``dispatch.json`` beside the recorder's file and is tried again, oldest first,
after a pause that doubles while sending keeps failing, so a GitHub or network outage
loses nothing. GitHub answers 422 both to a payload it refuses and to a burst it takes for
spam, so a notification is dropped only after ``refusals_before_drop`` refusals. Logs
name push categories, recipients and counts, never a notification's text.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services.instagram_emulator.notification_reader import Notification

log = logging.getLogger(__name__)
CONTROL = controlbox.notification_recording
# gh ends an API error with GitHub's status, as in "gh: Not Found (HTTP 404)".
_HTTP_STATUS = re.compile(r"\(HTTP (\d{3})\)")
_REFUSED = "422"
# Android's title for a notification: a direct message's or comment's sender.
_TITLE = "android.title"
_EMPTY: dict[str, Any] = {"handled": {}, "waiting": []}


class DispatchError(RuntimeError):
    """The dispatch did not reach GitHub, or GitHub did not take it this time."""


class DispatchRefused(DispatchError):
    """GitHub answered 422: it refused the payload, or took a burst of dispatches for spam."""


def dispatch(body: dict[str, Any]) -> None:
    """Send one repository dispatch (``body``, from ``payload``) to start the workflow.

    ``gh`` carries the Mac user's own GitHub login, so no token is kept here.
    """
    try:
        completed = subprocess.run(
            [
                "gh",
                "api",
                f"repos/{CONTROL.github_repo}/dispatches",
                "--method",
                "POST",
                "--input",
                "-",
            ],
            input=json.dumps(body),
            capture_output=True,
            text=True,
            timeout=CONTROL.dispatch_timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DispatchError(f"gh did not complete ({type(exc).__name__})") from exc
    if completed.returncode == 0:
        return
    status = _HTTP_STATUS.search(completed.stderr)
    if status is None:
        # GitHub never answered: gh, its login or the network failed. gh's own message
        # names which, and it never quotes the payload.
        lines = completed.stderr.strip().splitlines()
        raise DispatchError(lines[0][:200] if lines else f"gh exited {completed.returncode}")
    if status.group(1) == _REFUSED:
        raise DispatchRefused(f"HTTP {_REFUSED}")
    raise DispatchError(f"HTTP {status.group(1)}")


def payload(notification: Notification, account: str) -> dict[str, Any] | None:
    """The dispatch that starts the workflow for this notification, or None when the
    workflow does not take it.

    A post or digest goes whole, with the recipient and push ID the workflow routes and
    records it by. A direct message, request, mention or comment goes to the agent with
    only its category, school account, sender's name (Android's title for it) and time.
    """
    if not notification.recipient_id or not notification.push_id:
        return None
    if notification.category in CONTROL.dispatch_push_categories:
        return {
            "event_type": CONTROL.dispatch_event_type,
            "client_payload": {"notification_dict": notification.extras},
        }
    if notification.category in CONTROL.agent_push_categories and account:
        return agent_payload(
            notification.category,
            account,
            _sender(notification, account),
            datetime.fromtimestamp(notification.posted_at / 1000, timezone.utc),
        )
    return None


def agent_payload(category: str, account: str, sender: str, at: datetime) -> dict[str, Any]:
    """The ``instagram_interaction`` dispatch for the notification agent: only the
    category, school account, sender's name and time, never a message's text. The
    recorder sends one for each pushed DM, request, mention and comment, and the
    notification pull (``services/instagram_sessions/pull.py``) for each it finds itself."""
    return {
        "event_type": CONTROL.agent_dispatch_event_type,
        "client_payload": {
            "category": category,
            "account": account,
            "sender": sender,
            "received_at": at.astimezone(timezone.utc).isoformat(timespec="seconds"),
        },
    }


def _sender(notification: Notification, account: str) -> str:
    """The sender's name. On an Android user holding several accounts, Instagram titles a
    message "<recipient account>: <sender>" (angrygooseinuw, 2026-11-25); the account
    part is not the sender."""
    title = notification.text(_TITLE)
    return title.removeprefix(f"{account}: ")


def _key(notification: Notification) -> str:
    return f"{notification.recipient_id}:{notification.push_id}"


class Dispatcher:
    """Queues notifications for the workflow and sends what is due, kept in ``path``."""

    def __init__(
        self,
        path: Path,
        *,
        send: Callable[[dict[str, Any]], None] = dispatch,
        now: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._path = path
        self._send = send
        self._now = now
        self._sleep = sleep
        self._monotonic = monotonic
        state = _load(path)
        self._handled: dict[str, float] = dict(state["handled"])
        # Oldest first.
        self._waiting: list[dict[str, Any]] = list(state["waiting"])
        self._retry_at = 0.0
        self._retry_seconds = 0.0
        self._sent_at: float | None = None

    def __len__(self) -> int:
        return len(self._waiting)

    def offer(self, notification: Notification, account: str = "") -> bool:
        """Queue a notification the workflow takes, once; True when it was queued.
        ``account`` is the school account it was meant for, when known."""
        body = payload(notification, account)
        if body is None:
            return False
        key = _key(notification)
        if key in self._handled or any(item["key"] == key for item in self._waiting):
            return False
        self._waiting.append(
            {
                "key": key,
                "category": notification.category,
                "recipient_id": notification.recipient_id,
                "body": body,
                "refusals": 0,
            }
        )
        self._save()
        return True

    def send_due(self) -> None:
        """Send what waits, oldest first, ``send_spacing_seconds`` apart. A failed dispatch
        ends the pass, and sending waits a pause that doubles while failures go on."""
        if not self._waiting or self._monotonic() < self._retry_at:
            return
        for item in list(self._waiting):
            self._space_out()
            try:
                self._send(item["body"])
            except DispatchError as exc:
                self._pause_after(item, exc)
                return
            self._handle(item["key"])
            self._retry_seconds = 0.0
            log.info(
                "Started the workflow for a %s notification for %s (%d waiting)",
                item["category"],
                item["recipient_id"],
                len(self._waiting),
            )

    def _space_out(self) -> None:
        if self._sent_at is not None:
            wait = self._sent_at + CONTROL.send_spacing_seconds - self._monotonic()
            if wait > 0:
                self._sleep(wait)
        self._sent_at = self._monotonic()

    def _pause_after(self, item: dict[str, Any], exc: DispatchError) -> None:
        self._retry_seconds = min(
            max(self._retry_seconds * 2, CONTROL.retry_first_seconds), CONTROL.retry_longest_seconds
        )
        self._retry_at = self._monotonic() + self._retry_seconds
        if isinstance(exc, DispatchRefused):
            item["refusals"] += 1
            if item["refusals"] >= CONTROL.refusals_before_drop:
                self._handle(item["key"])
                log.error(
                    "GitHub refused a %s notification for %s %d times; dropped it",
                    item["category"],
                    item["recipient_id"],
                    item["refusals"],
                )
                return
            self._save()
        log.warning(
            "Could not start the workflow for a %s notification for %s (%s); "
            "%d waiting, trying again in %d s",
            item["category"],
            item["recipient_id"],
            exc,
            len(self._waiting),
            self._retry_seconds,
        )

    def _handle(self, key: str) -> None:
        """Take a notification off the queue for good: it was sent, or never can be."""
        now = self._now()
        horizon = now - CONTROL.remember_days * 86_400
        self._waiting = [item for item in self._waiting if item["key"] != key]
        self._handled = {seen: at for seen, at in self._handled.items() if at >= horizon}
        self._handled[key] = now
        self._save()

    def _save(self) -> None:
        state = {"handled": self._handled, "waiting": self._waiting}
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            atomic_write(self._path, json.dumps(state, sort_keys=True).encode())
        except OSError as exc:
            # A full disk: the queue stays in memory, and the next change saves it again.
            log.error("Could not save the dispatch queue (%s)", exc.strerror or exc)


def _load(path: Path) -> dict[str, Any]:
    """The saved queue, or an empty one; an unreadable one is moved aside."""
    try:
        state = json.loads(path.read_text())
    except FileNotFoundError:
        return _EMPTY
    except (OSError, ValueError):
        state = None
    if _readable(state):
        return state
    aside = path.with_name(f"{path.name}.unreadable-{int(time.time())}")
    try:
        path.replace(aside)
    except OSError as exc:
        log.error("Could not move the unreadable dispatch queue aside (%s)", exc.strerror)
    else:
        log.warning("The dispatch queue was unreadable; moved it to %s", aside.name)
    return _EMPTY


def _readable(state: Any) -> bool:
    return (
        isinstance(state, dict)
        and isinstance(state.get("handled"), dict)
        and all(isinstance(at, int | float) for at in state["handled"].values())
        and isinstance(state.get("waiting"), list)
        and all(
            isinstance(item, dict)
            and isinstance(item.get("key"), str)
            and isinstance(item.get("body"), dict)
            and isinstance(item.get("refusals"), int)
            for item in state["waiting"]
        )
    )
