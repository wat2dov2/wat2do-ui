#!/usr/bin/env python3
"""Keep the Instagram app's Android emulator running on the Mac.

``run`` stays running: it boots the virtual device whenever adb cannot see it, and
stops it when Android has answered no shell command for
``unresponsive_restart_seconds``, which happens after long uptimes: Android hangs
while adb still lists the device, so nothing else would ever restart it (on
2026-11-18 it hung from 06:30 to 19:50 and no notification or carousel got through).
An emulator that answers is left alone, even one someone started by hand.
``install-schedule`` installs it as a macOS LaunchAgent that keeps no logs.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
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
    emulator: subprocess.Popen[bytes] | None = None
    answered_at = time.monotonic()
    while True:
        if emulator is not None and emulator.poll() is not None:
            emulator = None
        if device.answers():
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
    """Stop a hung emulator through its console, and kill this process's own child if
    the console cannot reach it either. The next check boots a fresh one."""
    try:
        device.adb("emu", "kill")
    except EmulatorError:
        pass
    if emulator is None:
        return
    try:
        emulator.wait(timeout=CONTROL.adb_timeout_seconds)
    except subprocess.TimeoutExpired:
        emulator.kill()
        emulator.wait()


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
