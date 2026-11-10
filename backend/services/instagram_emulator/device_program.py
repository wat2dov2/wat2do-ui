"""Java programs the Mac keeps running on the emulator under app_process.

Each program's source sits in this folder and is built into the committed jar beside it by
``scripts/build_emulator_jars.py``, which also packs the source's SHA-256 into the jar so a
test fails while a jar lags its source. The Mac copies the jar to the device each time the
program starts, so it needs no JDK, and talks to the program over the standard input and
output of one ``adb shell``.
"""

from __future__ import annotations

import hashlib
import os
import select
import shlex
import subprocess
import time
import zipfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

_DIRECTORY = Path(__file__).parent
_STOP_SECONDS = 3


class DeviceProgramStopped(RuntimeError):
    """The program has ended, or no longer takes input."""


@dataclass(frozen=True)
class DeviceProgram:
    """``<main_class>.java`` in this folder, built into ``<name>.jar``."""

    main_class: str
    name: str

    @property
    def source(self) -> Path:
        return _DIRECTORY / f"{self.main_class}.java"

    @property
    def jar(self) -> Path:
        return _DIRECTORY / f"{self.name}.jar"

    @property
    def source_hash_entry(self) -> str:
        """The jar entry holding the SHA-256 of the source the jar was built from."""
        return f"{self.main_class}.java.sha256"

    @property
    def process_name(self) -> str:
        """The device-side process's name, so one left behind by a Mac process that died is found."""
        return f"wat2do-{self.name}"

    @property
    def remote_jar(self) -> str:
        return f"/data/local/tmp/{self.process_name}.jar"

    def source_hash(self) -> str:
        return hashlib.sha256(self.source.read_bytes()).hexdigest()

    def built_hash(self) -> str | None:
        """The SHA-256 of the source the committed jar was built from, if there is a jar."""
        try:
            with zipfile.ZipFile(self.jar) as jar:
                return jar.read(self.source_hash_entry).decode()
        except (FileNotFoundError, KeyError):
            return None


SCREEN_READER = DeviceProgram("ScreenReader", "screen-reader")
NOTIFICATION_READER = DeviceProgram("NotificationReader", "notification-reader")
# Every program the build script builds and the tests keep current.
PROGRAMS = (SCREEN_READER, NOTIFICATION_READER)


class DeviceProcess:
    """One program running on the device, its input and output piped through ``adb shell``."""

    def __init__(
        self,
        program: DeviceProgram,
        adb_path: str,
        serial: str,
        adb: Callable[..., str],
        *,
        root: bool = False,
        class_path: Sequence[str] = (),
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._program = program
        self._adb_path = adb_path
        self._serial = serial
        self._adb = adb
        self._root = root
        self._class_path = ":".join((program.remote_jar, *class_path))
        self._popen = popen
        self._monotonic = monotonic
        self._process: subprocess.Popen[bytes] | None = None
        self._pending = b""

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self, *arguments: str) -> None:
        """Copy the jar to the device and start the program, after ending any copy of it a
        Mac process that died left running."""
        self.stop()
        self._end_strays()
        self._adb("push", str(self._program.jar), self._program.remote_jar)
        command = (
            f"CLASSPATH={self._class_path} exec app_process / "
            f"--nice-name={self._program.process_name} io.wat2do.{self._program.main_class} "
            f"{shlex.join(arguments)}"
        )
        if self._root:
            command = f"su 0 sh -c {shlex.quote(command)}"
        self._process = self._popen(
            [self._adb_path, "-s", self._serial, "shell", "-T", command],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

    def write(self, data: bytes) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise DeviceProgramStopped("The program is not running")
        try:
            process.stdin.write(data)
            process.stdin.flush()
        except OSError as exc:
            raise DeviceProgramStopped("The program no longer takes input") from exc

    def read_until(self, marker: bytes, seconds: float) -> bytes | None:
        """Everything the program prints up to its next ``marker``, or None when the marker
        does not come within ``seconds``; raises ``DeviceProgramStopped`` once it has ended."""
        process = self._process
        if process is None or process.stdout is None:
            raise DeviceProgramStopped("The program is not running")
        stream = process.stdout.fileno()
        deadline = self._monotonic() + seconds
        while marker not in self._pending:
            remaining = deadline - self._monotonic()
            if remaining <= 0 or not select.select([stream], [], [], remaining)[0]:
                return None
            chunk = os.read(stream, 1 << 16)
            if not chunk:
                raise DeviceProgramStopped("The program ended")
            self._pending += chunk
        answer, self._pending = self._pending.split(marker, 1)
        return answer

    def stop(self) -> None:
        """Close the program's input, which ends it, or end it outright if it lingers."""
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
            self._end_strays()

    def _end_strays(self) -> None:
        kill = ("pkill", "-f", self._program.process_name)
        try:
            self._adb("shell", *(("su", "0", *kill) if self._root else kill))
        except Exception:
            # pkill fails when nothing matched, which is the usual case.
            pass
