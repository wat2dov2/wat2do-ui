"""Start the notification workflow for the post notifications the Mac's emulator gets.

The recorder (``services/notification_recording.py``) hands over each new notification
whose Instagram push category is in ``controlbox/notification_recording.json``
``dispatch_push_categories`` (posts and daily digests, never a direct message), and this
sends it as the ``new_instagram_post`` repository dispatch the phones' Automate flow sends,
which starts the ``process-notification`` workflow. It does not check whether a phone sent
the same notification: the workflow already records each recipient and push ID once.

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
_EMPTY: dict[str, Any] = {"handled": {}, "waiting": []}


class DispatchError(RuntimeError):
    """The dispatch did not reach GitHub, or GitHub did not take it this time."""


class DispatchRefused(DispatchError):
    """GitHub answered 422: it refused the payload, or took a burst of dispatches for spam."""


def dispatch(extras: dict[str, Any]) -> None:
    """Start the process-notification workflow for one notification, as the phones do.

    ``gh`` carries the Mac user's own GitHub login, so no token is kept here.
    """
    body = {
        "event_type": CONTROL.dispatch_event_type,
        "client_payload": {"notification_dict": extras},
    }
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


def wanted(notification: Notification) -> bool:
    """Whether the workflow takes this notification: a dispatched category, with the
    recipient and push ID it routes and records by."""
    return (
        notification.category in CONTROL.dispatch_push_categories
        and bool(notification.recipient_id)
        and bool(notification.push_id)
    )


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

    def offer(self, notification: Notification) -> bool:
        """Queue a notification the workflow takes, once; True when it was queued."""
        if not wanted(notification):
            return False
        key = _key(notification)
        if key in self._handled or any(item["key"] == key for item in self._waiting):
            return False
        self._waiting.append(
            {
                "key": key,
                "category": notification.category,
                "recipient_id": notification.recipient_id,
                "extras": notification.extras,
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
                self._send(item["extras"])
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
            and isinstance(item.get("extras"), dict)
            and isinstance(item.get("refusals"), int)
            for item in state["waiting"]
        )
    )
