"""The emulator's screen, read by one process kept running on the device.

`uiautomator dump` starts a Java runtime and connects to Android's accessibility
service for every read, which takes about two and a half seconds, and a song visit
reads the screen dozens of times. ``ScreenReader.java`` is that same dump kept running:
it connects once, then prints the active window's tree, the XML `uiautomator dump`
prints, each time it is asked. ``screen-reader.jar`` is built from it by
``scripts/build_screen_reader.py`` and copied to the device when a reader starts.

A reader starts on the first read of a hold on the emulator and stops when the hold
ends (``device.exclusive``), so the accessibility service is only connected while a job
drives the app, and two readers never fight over it.
"""

from __future__ import annotations

import hashlib
import os
import select
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

JAR = Path(__file__).with_name("screen-reader.jar")
SOURCE = Path(__file__).with_name("ScreenReader.java")
# The jar carries the SHA-256 of the source it was built from.
SOURCE_HASH_ENTRY = "ScreenReader.java.sha256"
REMOTE_JAR = "/data/local/tmp/wat2do-screen-reader.jar"
REMOTE_DUMP = "/data/local/tmp/wat2do-screen.xml"
# The device-side process's name, so a reader left behind by a worker that died is found.
PROCESS_NAME = "wat2do-screen-reader"
END = b"<<wat2do-screen-end>>\n"
_STOP_SECONDS = 3


class ScreenReaderError(RuntimeError):
    """The reader did not start, answer in time, or stay running."""


def source_hash() -> str:
    return hashlib.sha256(SOURCE.read_bytes()).hexdigest()


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
        self._adb_path = adb_path
        self._serial = serial
        self._adb = adb
        self._settle_milliseconds = settle_milliseconds
        self._settle_wait_seconds = settle_wait_seconds
        self._timeout_seconds = timeout_seconds
        self._popen = popen
        self._monotonic = monotonic
        self._process: subprocess.Popen[bytes] | None = None
        self._pending = b""

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def read(self) -> str:
        """The active window's tree as `uiautomator dump` prints it."""
        if not self.running:
            self._start()
        process = self._process
        assert process is not None and process.stdin is not None
        try:
            process.stdin.write(b"\n")
            process.stdin.flush()
        except OSError as exc:
            self.stop()
            raise ScreenReaderError("The screen reader stopped") from exc
        return self._answer().decode("utf-8", errors="replace").strip()

    def stop(self) -> None:
        """End the device-side process, which disconnects from the accessibility service."""
        process, self._process, self._pending = self._process, None, b""
        if process is None:
            return
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        try:
            process.wait(timeout=_STOP_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            self._end_stray_readers()

    def _start(self) -> None:
        self.stop()
        # A reader left by a worker that died still holds the accessibility service.
        self._end_stray_readers()
        self._adb("push", str(JAR), REMOTE_JAR)
        command = (
            f"CLASSPATH={REMOTE_JAR}:/system/framework/uiautomator.jar "
            f"exec app_process / --nice-name={PROCESS_NAME} io.wat2do.ScreenReader "
            f"{self._settle_milliseconds} {round(self._settle_wait_seconds * 1000)} {REMOTE_DUMP}"
        )
        self._process = self._popen(
            [self._adb_path, "-s", self._serial, "shell", "-T", command],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        # The first line says the reader is connected.
        self._answer()

    def _end_stray_readers(self) -> None:
        try:
            self._adb("shell", "pkill", "-f", PROCESS_NAME)
        except Exception:
            # pkill fails when nothing matched, which is the usual case.
            pass

    def _answer(self) -> bytes:
        """Everything the reader prints up to its next end marker."""
        process = self._process
        assert process is not None and process.stdout is not None
        stream = process.stdout.fileno()
        deadline = self._monotonic() + self._timeout_seconds
        while END not in self._pending:
            remaining = deadline - self._monotonic()
            ready = select.select([stream], [], [], max(remaining, 0))[0] if remaining > 0 else []
            if not ready:
                self.stop()
                raise ScreenReaderError("The screen reader did not answer")
            chunk = os.read(stream, 1 << 16)
            if not chunk:
                self.stop()
                raise ScreenReaderError("The screen reader stopped")
            self._pending += chunk
        answer, self._pending = self._pending.split(END, 1)
        return answer
