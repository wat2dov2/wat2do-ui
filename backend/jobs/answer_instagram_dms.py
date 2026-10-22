#!/usr/bin/env python3
"""Answer the school accounts' Instagram DMs from the emulator, at random times each day.

``run`` sweeps every account's inbox once its randomly chosen time has come;
``sweep`` sweeps right away; ``resume`` clears the pause left by a reply or repost
that could not be confirmed, once a person has checked it. ``install-schedule``
wakes ``run`` every few minutes through a macOS LaunchAgent that keeps no logs.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402
from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services.instagram_dms import sweep  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram.dms"


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartInterval": controlbox.instagram_dms.sweep_check_interval_seconds,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Sweep every inbox if its random time has come")
    commands.add_parser("sweep", help="Sweep every inbox now")
    commands.add_parser("resume", help="Clear a pause after checking what it names")
    commands.add_parser("install-schedule", help="Wake run through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=controlbox.instagram_dms.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    if args.command == "resume":
        sweep.resume()
        print("Resumed")
        return 0
    result = sweep.sweep() if args.command == "sweep" else sweep.run_if_due()
    print(json.dumps(result, sort_keys=True))
    return 1 if result["status"] == "paused" or result.get("failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
