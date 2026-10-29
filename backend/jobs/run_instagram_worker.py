#!/usr/bin/env python3
"""Drive the Instagram app on the emulator: one account at a time, everything it needs.

``run`` keeps visiting school accounts: songs for new carousels, DMs, follows and
Following-list crawls (``services/instagram_worker.py``). ``resume-dms`` clears the
pause left by a reply or repost that could not be confirmed, once a person has
checked it. ``install-schedule`` keeps ``run`` alive through a macOS LaunchAgent that
keeps no logs.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services import instagram_worker  # noqa: E402
from services.instagram_dms import sweep  # noqa: E402
from services.instagram_emulator.device import CONTROL  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram.worker"


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Keep visiting school accounts")
    commands.add_parser("resume-dms", help="Clear a DM pause after checking what it names")
    commands.add_parser("install-schedule", help="Keep run alive through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=CONTROL.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    if args.command == "resume-dms":
        sweep.resume()
        print("Resumed")
        return 0
    instagram_worker.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
