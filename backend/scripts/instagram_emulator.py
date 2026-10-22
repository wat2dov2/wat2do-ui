#!/usr/bin/env python3
"""Keep the Instagram app's Android emulator running on the Mac.

``run`` stays running: it boots the virtual device whenever adb cannot see it and
otherwise only checks again later, so an emulator someone started by hand is left
alone. ``install-schedule`` installs it as a macOS LaunchAgent that keeps no logs.
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
    emulator_command,
)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram-emulator"


def launch_agent_payload() -> dict[str, Any]:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def run() -> None:
    device = EmulatorDevice()
    while True:
        if not device.is_online():
            # The emulator runs as this process's child until it exits.
            subprocess.run(
                emulator_command(),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        time.sleep(CONTROL.keep_alive_check_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Boot the emulator whenever it is not running")
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
