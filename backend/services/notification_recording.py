"""Record the Instagram notifications the Mac's emulator gets, and start the notification
workflow for its posts.

The school accounts are active in the Instagram app on the Mac's Android emulator, so
Instagram pushes many of their notifications there. Through ``NotificationReader`` the
recorder appends one JSON line per notification to
``~/.local/state/wat2do/notification-log/notifications.jsonl``, and hands each new post or
daily digest to ``services/notification_dispatch.py``, which starts the
``process-notification`` workflow for it just as the physical phones do. Nothing checks
whether a phone sent the same notification: the workflow records each recipient and push
ID once. Beyond that the recorder only listens: no Android user started or stopped, no
tap on the emulator, and it never holds the emulator's lock.

A line holds when the notification was posted and recorded, its Android user, the
school account it was meant for (its Instagram ID, and its username once a notification
has named it), Instagram's push category, the channel and every extra the reader
carries. A direct message keeps only its push category, Android user, recipient and
times, never its sender, title or text: this repository is public, and DM text is never
logged anywhere, nor ever dispatched. Group summaries only repeat the notifications under
them and are skipped.

A notification is written once: by its recipient and Instagram's push ID, or by Android's
key and post time when no push started it, remembered for ``remember_days``, so what a
reader replays when it starts again (the notifications still showing) is not written
twice. When the emulator restarts, as the worker has it do every morning, or adb goes
away, the reader ends and the recorder starts it again once the emulator has booted,
waiting a pause that doubles while it stays down.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import os
import re
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, adb_path
from services.instagram_emulator.notification_reader import (
    Notification,
    NotificationReader,
    NotificationReaderError,
)
from services.notification_dispatch import Dispatcher

log = logging.getLogger(__name__)
CONTROL = controlbox.notification_recording
DIRECTORY = Path.home() / ".local/state/wat2do/notification-log"
LOG_PATH = DIRECTORY / "recorder.log"
FILE_NAME = "notifications.jsonl"
_STATE_NAME = "state.json"
_DISPATCH_NAME = "dispatch.json"
_LOCK_NAME = "recorder.lock"
# Instagram names the account a notification is for in its subText, as on the phones.
_SUBTEXT = "android.subText"
_SCHOOL_ACCOUNT = re.compile(r"^wat2do\.[a-z0-9._]{1,30}$")
_TEMPLATE = "android.template"
# Android's category for a message (Notification.CATEGORY_MESSAGE).
_MESSAGE = "msg"
# Extras only a conversation carries (Notification.MessagingStyle).
_CONVERSATION_EXTRAS = frozenset(
    {
        "android.conversationTitle",
        "android.hiddenConversationTitle",
        "android.isGroupConversation",
        "android.selfDisplayName",
    }
)


def is_direct_message(notification: Notification) -> bool:
    """Whether the notification is, or may be, a direct message.

    Any one sign is enough: Instagram's push category or the Android channel naming one
    (``direct_message_markers``), Android's message category, or a conversation's style.
    """
    markers = CONTROL.direct_message_markers
    return (
        any(marker in notification.category for marker in markers)
        or any(marker in notification.channel for marker in markers)
        or notification.android_category == _MESSAGE
        or "MessagingStyle" in notification.text(_TEMPLATE)
        or not _CONVERSATION_EXTRAS.isdisjoint(notification.extras)
    )


def entry(
    notification: Notification, *, direct: bool, account: str, recorded_at: datetime
) -> dict[str, Any]:
    """The line recorded for the notification; a direct message's carries no text."""
    line: dict[str, Any] = {
        "recorded_at": recorded_at.isoformat(timespec="seconds"),
        "posted_at": datetime.fromtimestamp(notification.posted_at / 1000)
        .astimezone()
        .isoformat(timespec="seconds"),
        "android_user": notification.android_user,
        "recipient_id": notification.recipient_id or None,
        "account": account or None,
        "category": notification.category or None,
    }
    if direct:
        # Its sender, title, text and thread stay out of the file.
        line["direct_message"] = True
        return line
    line["channel"] = notification.channel or None
    line["extras"] = notification.extras
    return line


def _identity(notification: Notification) -> str:
    """What a notification counts once by, hashed, so the state names no thread."""
    if notification.push_id:
        identity = f"push:{notification.recipient_id}:{notification.push_id}"
    else:
        identity = f"posted:{notification.key}:{notification.posted_at}"
    return hashlib.sha256(identity.encode()).hexdigest()[:32]


class NotificationLog:
    """``notifications.jsonl`` in ``directory``, and what it already holds.

    The file is rotated at ``file_max_bytes``, keeping ``file_backup_count`` old files
    (``notifications.jsonl.1`` the newest). ``state.json`` beside it remembers which
    notifications were written and the school account usernames notifications named.
    """

    def __init__(self, directory: Path, *, now: Callable[[], datetime] = datetime.now) -> None:
        self._directory = directory
        self._path = directory / FILE_NAME
        self._state_path = directory / _STATE_NAME
        self._now = now
        state = _load(self._state_path)
        self._seen: dict[str, float] = dict(state["seen"])
        self._accounts: dict[str, str] = dict(state["accounts"])

    def record(self, notification: Notification) -> bool:
        """Write the notification unless it was written before; True when written."""
        if notification.group_summary:
            return False
        identity = _identity(notification)
        if identity in self._seen:
            return False
        direct = is_direct_message(notification)
        if not direct:
            self._learn_account(notification)
        recorded_at = self._now().astimezone()
        line = entry(
            notification,
            direct=direct,
            account=self._accounts.get(notification.recipient_id, ""),
            recorded_at=recorded_at,
        )
        self._append((json.dumps(line, ensure_ascii=False) + "\n").encode())
        # Saved only once the line is in the file: a crash in between writes it twice
        # rather than never.
        self._seen[identity] = recorded_at.timestamp()
        self._save(recorded_at.timestamp())
        return True

    def _learn_account(self, notification: Notification) -> None:
        subtext = notification.text(_SUBTEXT)
        if notification.recipient_id and _SCHOOL_ACCOUNT.match(subtext):
            self._accounts[notification.recipient_id] = subtext

    def _append(self, line: bytes) -> None:
        self._directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            size = self._path.stat().st_size
        except FileNotFoundError:
            size = 0
        if size and size + len(line) > CONTROL.file_max_bytes:
            self._rotate()
        descriptor = os.open(self._path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "ab") as handle:
            handle.write(line)

    def _rotate(self) -> None:
        """Shift each old file up one number, dropping the oldest, and start afresh."""
        for number in range(CONTROL.file_backup_count - 1, 0, -1):
            older = self._directory / f"{FILE_NAME}.{number}"
            if older.exists():
                older.replace(self._directory / f"{FILE_NAME}.{number + 1}")
        self._path.replace(self._directory / f"{FILE_NAME}.1")

    def _save(self, now: float) -> None:
        horizon = now - CONTROL.remember_days * 86_400
        self._seen = {identity: at for identity, at in self._seen.items() if at >= horizon}
        state = {"seen": self._seen, "accounts": self._accounts}
        try:
            atomic_write(self._state_path, json.dumps(state, sort_keys=True).encode())
        except OSError as exc:
            # A full disk: the state stays in memory, and the next notification saves it.
            log.error("Could not save the recorder's state (%s)", exc.strerror or exc)


_EMPTY: dict[str, Any] = {"seen": {}, "accounts": {}}


def _load(path: Path) -> dict[str, Any]:
    """The saved state, or an empty one. A state that cannot be read is moved aside, so
    the recorder starts afresh instead of failing every time it starts."""
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
        log.error("Could not move the recorder's unreadable state aside (%s)", exc.strerror)
    else:
        log.warning("The recorder's state was unreadable; moved it to %s", aside.name)
    return _EMPTY


def _readable(state: Any) -> bool:
    return (
        isinstance(state, dict)
        and isinstance(state.get("seen"), dict)
        and all(isinstance(at, int | float) for at in state["seen"].values())
        and isinstance(state.get("accounts"), dict)
        and all(isinstance(account, str) for account in state["accounts"].values())
    )


class Recorder:
    """Keeps a reader listening on the emulator, writes what it hears and starts the
    workflow for its posts."""

    def __init__(
        self,
        device: EmulatorDevice,
        reader: NotificationReader,
        notifications: NotificationLog,
        dispatcher: Dispatcher,
        *,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._device = device
        self._reader = reader
        self._notifications = notifications
        self._dispatcher = dispatcher
        self._sleep = sleep
        self._monotonic = monotonic
        self._up: bool | None = None
        self._pause = 0.0
        self._heard_at = 0.0
        self._recorded = 0

    def run_forever(self) -> None:
        while True:
            try:
                self.step()
            except Exception:
                log.exception("The notification recorder failed a step")
                self._reader.stop()
                self._back_off()

    def step(self) -> None:
        """Send the posts due to the workflow, then listen for ``listen_seconds``, or wait
        for the emulator and start listening."""
        self._dispatcher.send_due()
        if not self._reader.running:
            self._connect()
            return
        try:
            for notification in self._reader.notifications(CONTROL.listen_seconds):
                self._heard_at = self._monotonic()
                if self._notifications.record(notification):
                    self._recorded += 1
                    if not is_direct_message(notification):
                        self._dispatcher.offer(notification)
        except NotificationReaderError as exc:
            # Usually the emulator restarting; the next step waits for it.
            log.info("%s after recording %d notifications", exc, self._recorded)
            self._back_off()
            return
        if self._monotonic() - self._heard_at >= CONTROL.quiet_restart_minutes * 60:
            log.info(
                "The reader has been quiet for %d min; starting it again",
                CONTROL.quiet_restart_minutes,
            )
            self._reader.stop()

    def _connect(self) -> None:
        up = self._device.is_online() and self._device.booted()
        if up != self._up:
            log.info("The emulator is up" if up else "The emulator is down; waiting for it")
            self._up = up
        if not up:
            self._back_off()
            return
        try:
            self._reader.start()
        except NotificationReaderError as exc:
            log.warning("%s; trying again", exc)
            self._back_off()
            return
        self._pause = 0.0
        self._heard_at = self._monotonic()
        self._recorded = 0
        log.info("Listening for Instagram notifications on the emulator")

    def _back_off(self) -> None:
        self._pause = min(
            max(self._pause * 2, CONTROL.reconnect_first_seconds),
            CONTROL.reconnect_longest_seconds,
        )
        self._sleep(self._pause)


def run_forever() -> None:
    with _only_recorder():
        device = EmulatorDevice()
        reader = NotificationReader(
            adb_path(),
            EMULATOR.serial,
            device.adb,
            package=EMULATOR.instagram_package,
            timeout_seconds=EMULATOR.adb_timeout_seconds,
        )
        try:
            Recorder(
                device, reader, NotificationLog(DIRECTORY), Dispatcher(DIRECTORY / _DISPATCH_NAME)
            ).run_forever()
        finally:
            reader.stop()


@contextmanager
def _only_recorder() -> Iterator[None]:
    """Hold the recorders' lock: each would end the other's reader on the device."""
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (DIRECTORY / _LOCK_NAME).open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("Another notification recorder is running") from exc
        yield
