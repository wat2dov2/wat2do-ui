"""Instagram's notifications on the emulator, read by one root process on the device.

``NotificationReader.java`` registers with Android's notification service the way the
system's own listeners do, for every Android user at once, and prints each of the app's
notifications as one JSON line: its Android user, key, post time, channel, category,
whether it is a group summary, and the extras that JSON can carry. It only listens,
and what is kept of a line is the caller's choice. ``notification-reader.jar`` is built
from it by ``scripts/build_emulator_jars.py`` and copied to the device each time a reader
starts.

Only Android users that are running get notifications. A reader prints the notifications
still showing when it starts, then each new one as it is posted, so one that starts again
misses nothing still on screen; the same notification can therefore come more than once.
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from services.instagram_emulator.device_program import (
    NOTIFICATION_READER,
    DeviceProcess,
    DeviceProgramStopped,
)

log = logging.getLogger(__name__)

READY = b"<<wat2do-notifications-ready>>\n"
_LINE_END = b"\n"
# Instagram's own extras on each notification it builds from a push.
PUSH_CATEGORY = "com.instagram.android.igns.logging.push_category"
PUSH_ID = "com.instagram.android.igns.logging.push_id"
RECIPIENT_ID = "com.instagram.android.igns.logging.intended_recipient_id"


class NotificationReaderError(RuntimeError):
    """The reader did not start, or it stopped."""


@dataclass(frozen=True)
class Notification:
    """One notification, as the reader printed it."""

    android_user: int
    # Android's key for the notification; an update to it keeps the key.
    key: str
    # When Android last posted it, in milliseconds since the epoch.
    posted_at: int
    channel: str
    # Android's category for it ("msg" for a message), not Instagram's push category.
    android_category: str
    group_summary: bool
    # Kept out of the repr, so nothing that prints a notification can quote its text.
    extras: dict[str, Any] = field(repr=False)

    @classmethod
    def parse(cls, line: bytes) -> Notification | None:
        """The notification a reader line holds, or None for a line that holds none."""
        try:
            fields = json.loads(line)
            notification = cls(
                android_user=fields["user"],
                key=fields["key"],
                posted_at=fields["posted_at"],
                channel=fields["channel"] or "",
                android_category=fields["category"] or "",
                group_summary=fields["group_summary"],
                extras=fields["extras"],
            )
        except (ValueError, TypeError, KeyError):
            return None
        valid = (
            isinstance(notification.android_user, int)
            and isinstance(notification.key, str)
            and isinstance(notification.posted_at, int)
            and isinstance(notification.channel, str)
            and isinstance(notification.android_category, str)
            and isinstance(notification.group_summary, bool)
            and isinstance(notification.extras, dict)
        )
        return notification if valid else None

    @property
    def category(self) -> str:
        """Instagram's push category, empty for a notification no push started."""
        return self.text(PUSH_CATEGORY)

    @property
    def push_id(self) -> str:
        return self.text(PUSH_ID)

    @property
    def recipient_id(self) -> str:
        """The school account the notification was meant for, by its Instagram ID."""
        return self.text(RECIPIENT_ID)

    def text(self, key: str) -> str:
        value = self.extras.get(key)
        return value.strip() if isinstance(value, str) else ""


class NotificationReader:
    """Listens for one app's notifications on every Android user."""

    def __init__(
        self,
        adb_path: str,
        serial: str,
        adb: Callable[..., str],
        *,
        package: str,
        timeout_seconds: float,
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._process = DeviceProcess(
            NOTIFICATION_READER,
            adb_path,
            serial,
            adb,
            root=True,
            popen=popen,
            monotonic=monotonic,
        )
        self._package = package
        self._timeout_seconds = timeout_seconds
        self._monotonic = monotonic

    @property
    def running(self) -> bool:
        return self._process.running

    def start(self) -> None:
        """Start listening; returns once Android has connected the listener."""
        self._process.start(self._package)
        if self._read(READY, self._timeout_seconds) is None:
            self.stop()
            raise NotificationReaderError("The notification reader did not start")

    def notifications(self, seconds: float) -> Iterator[Notification]:
        """Each notification the reader prints within ``seconds``, as it prints it."""
        deadline = self._monotonic() + seconds
        while (remaining := deadline - self._monotonic()) > 0:
            line = self._read(_LINE_END, remaining)
            if line is None:
                return
            notification = Notification.parse(line)
            if notification is None:
                log.warning("The notification reader printed a line that is not a notification")
            else:
                yield notification

    def stop(self) -> None:
        self._process.stop()

    def _read(self, marker: bytes, seconds: float) -> bytes | None:
        try:
            return self._process.read_until(marker, seconds)
        except DeviceProgramStopped as exc:
            self.stop()
            raise NotificationReaderError("The notification reader stopped") from exc
