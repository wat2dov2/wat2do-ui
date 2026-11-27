#!/usr/bin/env python3
"""Keep the Instagram app's Android emulator running on the Mac.

``run`` stays running: it boots the virtual device whenever adb cannot see it, and
stops it when Android has answered no shell command for
``unresponsive_restart_seconds``, which happens after long uptimes: Android hangs
while adb still lists the device, so nothing else would ever restart it (on
2026-11-18 it hung from 06:30 to 19:50 and no notification or carousel got through).
It also restarts it, holding the emulator's lock so no job is cut off mid-step, once
qemu has used at least ``spin_cpu_percent`` of the Mac's CPU while Android used at most
``spin_guest_cpu_percent`` for ``spin_restart_seconds`` straight: with ``-gpu host``
qemu's render threads can get stuck spinning in ``EglContext::~EglContext`` (on
2026-11-25 qemu ran at 480-630% for about 9 hours while Android sat mostly idle).
It also restarts it, under the lock too, once Android has reached no Instagram server
for ``offline_restart_seconds``: on 2026-11-27 its network interfaces stayed down for
hours (through four restarts) while it answered every shell command, and every story
posted then stayed on the phone. Mobile data and Wi-Fi are turned back on as soon as the
network is found down, before the restart.
Any other emulator that answers is left alone, even one someone started by hand.
``install-schedule`` installs it as a macOS LaunchAgent that keeps no logs.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import install_launch_agent  # noqa: E402
from services.instagram_emulator.device import (  # noqa: E402
    CONTROL,
    EmulatorDevice,
    EmulatorError,
    emulator_command,
    exclusive,
    log_restart,
)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram-emulator"


def launch_agent_payload() -> dict[str, Any]:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "KeepAlive": True,
        # Standard, not Background: launchd runs a Background agent and its children (qemu, adb) at the lowest
        # CPU priority, beside Spotlight's indexers, and on 2026-11-23 a busy Mac starved Android until it rebooted.
        "ProcessType": "Standard",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def run() -> None:
    device = EmulatorDevice()
    spin = SpinWatch()
    offline = OfflineWatch()
    emulator: subprocess.Popen[bytes] | None = None
    answered_at = time.monotonic()
    while True:
        if emulator is not None and emulator.poll() is not None:
            emulator = None
        if device.answers():
            answered_at = time.monotonic()
            reason = offline.check(device) or spin.check(device)
            if reason:
                # Waits until no job holds the emulator, so none is cut off mid-step.
                with exclusive():
                    log_restart(reason)
                    stop(device, emulator)
                emulator = None
                answered_at = time.monotonic()
        elif emulator is None and not device.is_online():
            # The emulator runs as this process's child until it exits.
            emulator = subprocess.Popen(
                emulator_command(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            answered_at = time.monotonic()
        elif time.monotonic() - answered_at >= CONTROL.unresponsive_restart_seconds:
            minutes = round((time.monotonic() - answered_at) / 60)
            log_restart(f"Android answered no adb shell command for {minutes} min")
            stop(device, emulator)
            emulator = None
            answered_at = time.monotonic()
        time.sleep(CONTROL.keep_alive_check_seconds)


def stop(device: EmulatorDevice, emulator: subprocess.Popen[bytes] | None) -> None:
    """Stop the emulator through its console, and kill its qemu process if it has not
    exited ``stop_wait_seconds`` later. The next check boots a fresh one.

    The console's kill is not enough on its own: Android may be too hung to take it, and
    on 2026-11-25 it answered OK while qemu, stuck in its render threads, kept running.
    The process is found by its virtual device, so one started by hand is stopped too.
    """
    process = None if emulator is not None else emulator_process()
    try:
        device.adb("emu", "kill")
    except EmulatorError:
        pass
    if emulator is not None:
        try:
            emulator.wait(timeout=CONTROL.stop_wait_seconds)
        except subprocess.TimeoutExpired:
            emulator.kill()
            emulator.wait()
        return
    if process is None:
        return
    deadline = time.monotonic() + CONTROL.stop_wait_seconds
    while time.monotonic() < deadline:
        if not _running(process.pid):
            return
        time.sleep(1)
    try:
        os.kill(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


@dataclass(frozen=True)
class EmulatorProcess:
    pid: int
    cpu_seconds: float


def emulator_process() -> EmulatorProcess | None:
    """The qemu process running the configured virtual device, whoever started it, and
    the CPU time all its threads have used. The ``emulator`` launcher execs into qemu,
    so the keep-alive's own child is this process."""
    try:
        listing = subprocess.run(
            ["ps", "-axww", "-o", "pid=,time=,command="],
            capture_output=True,
            text=True,
            timeout=CONTROL.adb_timeout_seconds,
            check=False,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in listing.splitlines():
        fields = line.split(maxsplit=2)
        if len(fields) == 3 and _runs_device(fields[2].split()):
            try:
                return EmulatorProcess(int(fields[0]), _cpu_seconds(fields[1]))
            except ValueError:
                return None
    return None


def _runs_device(arguments: list[str]) -> bool:
    return (
        Path(arguments[0]).name.startswith("qemu-system-")
        and _option(arguments, "-avd") == CONTROL.avd_name
        and _option(arguments, "-port") == CONTROL.serial.removeprefix("emulator-")
    )


def _option(arguments: list[str], name: str) -> str | None:
    if name not in arguments[:-1]:
        return None
    return arguments[arguments.index(name) + 1]


def _cpu_seconds(cpu_time: str) -> float:
    """Seconds from ps's CPU time: "397:33.44" (minutes:seconds) on macOS,
    "[days-]hours:minutes:seconds" elsewhere."""
    days, _, clock = cpu_time.rpartition("-")
    seconds = 0.0
    for part in clock.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds + int(days or 0) * 86_400


@dataclass(frozen=True)
class AndroidCpu:
    """Android's own CPU counters, in clock ticks summed over its cores."""

    busy: int
    total: int
    cores: int


def android_cpu(device: EmulatorDevice) -> AndroidCpu | None:
    try:
        lines = device.adb("shell", "cat", "/proc/stat").splitlines()
    except EmulatorError:
        return None
    cores = sum(1 for line in lines if line.startswith("cpu") and line[3:4].isdigit())
    summary = next((line for line in lines if line.startswith("cpu ")), None)
    if summary is None or not cores:
        return None
    # user nice system idle iowait irq softirq steal; guest time is inside user and nice.
    try:
        ticks = [int(value) for value in summary.split()[1:9]]
    except ValueError:
        return None
    if len(ticks) < 5:
        return None
    return AndroidCpu(busy=sum(ticks) - ticks[3] - ticks[4], total=sum(ticks), cores=cores)


@dataclass(frozen=True)
class _Sample:
    at: float
    process: EmulatorProcess
    android: AndroidCpu


class SpinWatch:
    """Notices qemu burning the Mac's CPU on work Android is not doing.

    Each check samples qemu's CPU time and Android's own counters; a stretch where every
    interval between checks had qemu at ``spin_cpu_percent`` or more and Android at
    ``spin_guest_cpu_percent`` or less is a spin, and once it has lasted
    ``spin_restart_seconds`` the check says why the emulator needs a restart. A busy
    Android (booting, playing video) explains a busy qemu, so it never counts.
    """

    def __init__(self) -> None:
        self._last: _Sample | None = None
        self._start: _Sample | None = None

    def check(self, device: EmulatorDevice) -> str | None:
        """Why the emulator should restart now, or None while it is not spinning."""
        process = emulator_process()
        android = android_cpu(device) if process is not None else None
        sample = (
            None
            if process is None or android is None
            else _Sample(time.monotonic(), process, android)
        )
        last, self._last = self._last, sample
        if sample is None or last is None or not _spinning(last, sample):
            self._start = None
            return None
        self._start = self._start or last
        if sample.at - self._start.at < CONTROL.spin_restart_seconds:
            return None
        start, self._start, self._last = self._start, None, None
        qemu, android_percent = _percents(start, sample)
        return (
            f"qemu used {qemu:.0f}% CPU while Android used {android_percent:.0f}% for "
            f"{round((sample.at - start.at) / 60)} min (render threads spinning)"
        )


class OfflineWatch:
    """Times how long Android has reached no Instagram server; once that is
    ``offline_restart_seconds``, the check says why the emulator needs a restart."""

    def __init__(self) -> None:
        self._since: float | None = None

    def check(self, device: EmulatorDevice) -> str | None:
        """Why the emulator should restart now, or None while its network works."""
        now = time.monotonic()
        if device.has_network():
            self._since = None
            return None
        if self._since is None:
            self._since = now
            _radios_on(device)
        if now - self._since < CONTROL.offline_restart_seconds:
            return None
        minutes = round((now - self._since) / 60)
        self._since = None
        return f"Android had no network for {minutes} min"


def _radios_on(device: EmulatorDevice) -> None:
    """Turn mobile data and Wi-Fi back on: the emulator reaches the internet through its
    emulated carrier, so data left off keeps it offline across restarts. Each command
    does nothing when that radio is already on."""
    for radio in ("data", "wifi"):
        try:
            device.adb("shell", "svc", radio, "enable")
        except EmulatorError:
            pass


def _spinning(earlier: _Sample, later: _Sample) -> bool:
    if earlier.process.pid != later.process.pid:
        return False
    qemu, android = _percents(earlier, later)
    return qemu >= CONTROL.spin_cpu_percent and android <= CONTROL.spin_guest_cpu_percent


def _percents(earlier: _Sample, later: _Sample) -> tuple[float, float]:
    """qemu's and Android's CPU use between two samples, in percent of one core."""
    seconds = later.at - earlier.at
    qemu = (
        (later.process.cpu_seconds - earlier.process.cpu_seconds) / seconds * 100
        if seconds > 0
        else 0.0
    )
    ticks = later.android.total - earlier.android.total
    android = (
        (later.android.busy - earlier.android.busy) / ticks * later.android.cores * 100
        if ticks > 0
        else 0.0
    )
    return qemu, android


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Boot the emulator whenever it is not running or hung")
    commands.add_parser("install-schedule", help="Keep run alive through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=CONTROL.adb_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
