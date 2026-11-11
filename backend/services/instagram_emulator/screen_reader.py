"""The emulator's screen, read by one process kept running on the device.

`uiautomator dump` starts a Java runtime and connects to Android's accessibility
service for every read, which takes about two and a half seconds, and a song visit
reads the screen dozens of times. ``ScreenReader.java`` is that same dump kept running:
it connects once, then prints the active window's tree, the XML `uiautomator dump`
prints, each time it is asked. ``screen-reader.jar`` is built from it by
``scripts/build_emulator_jars.py`` and copied to the device when a reader starts.

A reader starts on the first read of a hold on the emulator and stops when the hold
ends (``device.exclusive``), so the accessibility service is only connected while a job
drives the app, and two readers never fight over it.
"""

from __future__ import annotations

import subprocess
import time
from collections.abc import Callable

from services.instagram_emulator.device_program import (
    SCREEN_READER,
    DeviceProcess,
    DeviceProgramStopped,
)

REMOTE_DUMP = "/data/local/tmp/wat2do-screen.xml"
# `uiautomator dump`'s own classes, which the reader calls.
_UIAUTOMATOR = "/system/framework/uiautomator.jar"
END = b"<<wat2do-screen-end>>\n"


class ScreenReaderError(RuntimeError):
    """The reader did not start, answer in time, or stay running."""


class ScreenReader:
    """Reads the active window's accessibility tree through one device-side process."""

    def __init__(
        self,
        adb_path: str,
        serial: str,
        adb: Callable[..., str],
        *,
        settle_milliseconds: int,
        settle_wait_seconds: float,
        timeout_seconds: float,
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._process = DeviceProcess(
            SCREEN_READER,
            adb_path,
            serial,
            adb,
            class_path=(_UIAUTOMATOR,),
            popen=popen,
            monotonic=monotonic,
        )
        self._settle_milliseconds = settle_milliseconds
        self._settle_wait_seconds = settle_wait_seconds
        self._timeout_seconds = timeout_seconds

    @property
    def running(self) -> bool:
        return self._process.running

    def read(self) -> str:
        """The active window's tree as `uiautomator dump` prints it."""
        if not self.running:
            self._start()
        try:
            self._process.write(b"\n")
        except DeviceProgramStopped as exc:
            self.stop()
            raise ScreenReaderError("The screen reader stopped") from exc
        return self._answer().decode("utf-8", errors="replace").strip()

    def stop(self) -> None:
        """End the device-side process, which disconnects from the accessibility service."""
        self._process.stop()

    def _start(self) -> None:
        self._process.start(
            str(self._settle_milliseconds),
            str(round(self._settle_wait_seconds * 1000)),
            REMOTE_DUMP,
        )
        # The first end marker says the reader is connected.
        self._answer()

    def _answer(self) -> bytes:
        """Everything the reader prints up to its next end marker."""
        try:
            answer = self._process.read_until(END, self._timeout_seconds)
        except DeviceProgramStopped as exc:
            self.stop()
            raise ScreenReaderError("The screen reader stopped") from exc
        if answer is None:
            self.stop()
            raise ScreenReaderError("The screen reader did not answer")
        return answer
