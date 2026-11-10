"""Instagram's notifications on the emulator, read by one root process on the device.

``NotificationReader.java`` registers with Android's notification service the way the
system's own listeners do, for every Android user at once, and prints each Instagram
notification whose push category it is given as one JSON line: the extras the phones'
Automate flow forwarded (text, flags and numbers). Every other notification, a direct
message's included, stays on the device. ``notification-reader.jar`` is built from it by
``scripts/build_emulator_jars.py`` and copied to the device each time a reader starts.

Only Android users that are running get notifications. A reader prints the notifications
still showing when it starts, then each new one as it is posted, so one that starts again
misses nothing still on screen; the same notification can therefore come more than once.
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Any

from services.instagram_emulator.device_program import (
    NOTIFICATION_READER,
    DeviceProcess,
    DeviceProgramStopped,
)

log = logging.getLogger(__name__)

READY = b"<<wat2do-notifications-ready>>\n"
_LINE_END = b"\n"
# Instagram's own extras on each notification.
PUSH_CATEGORY = "com.instagram.android.igns.logging.push_category"
PUSH_ID = "com.instagram.android.igns.logging.push_id"
RECIPIENT_ID = "com.instagram.android.igns.logging.intended_recipient_id"


class NotificationReaderError(RuntimeError):
    """The reader did not start, or it stopped."""


@dataclass(frozen=True)
class Notification:
    """One notification's extras, as the reader printed them."""

    extras: dict[str, Any]

    @property
    def category(self) -> str:
        return self._text(PUSH_CATEGORY)

    @property
    def push_id(self) -> str:
        return self._text(PUSH_ID)

    @property
    def recipient_id(self) -> str:
        """The school account the notification was meant for, by its Instagram ID."""
        return self._text(RECIPIENT_ID)

    def _text(self, key: str) -> str:
        value = self.extras.get(key)
        return value.strip() if isinstance(value, str) else ""


class NotificationReader:
    """Listens for an app's notifications in the given push categories on every Android user."""

    def __init__(
        self,
        adb_path: str,
        serial: str,
        adb: Callable[..., str],
        *,
        package: str,
        categories: Iterable[str],
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
        self._arguments = (package, *categories)
        self._timeout_seconds = timeout_seconds
        self._monotonic = monotonic

    @property
    def running(self) -> bool:
        return self._process.running

    def start(self) -> None:
        """Start listening; returns once Android has connected the listener."""
        self._process.start(*self._arguments)
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
            try:
                extras = json.loads(line)
            except ValueError:
                extras = None
            if isinstance(extras, dict):
                yield Notification(extras)
            else:
                log.warning("The notification reader printed a line that is not a notification")

    def stop(self) -> None:
        self._process.stop()

    def _read(self, marker: bytes, seconds: float) -> bytes | None:
        try:
            return self._process.read_until(marker, seconds)
        except DeviceProgramStopped as exc:
            self.stop()
            raise NotificationReaderError("The notification reader stopped") from exc
