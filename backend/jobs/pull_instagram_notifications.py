#!/usr/bin/env python3
"""Read the DMs, message requests and comments of school accounts Instagram stopped
pushing, and hand what is new to the notification agent.

``run`` reads, one account per hold of the emulator, every school account the recorder
has heard nothing from for ``controlbox/notification_pull.json`` ``silence_hours``, and
dispatches each unread thread, request and new comment to the "Handle notification"
workflow as a push would (``services/instagram_sessions/pull.py``); ``--school`` reads
only those schools, heard lately or not. It prints one line of counts per account and
logs the same to ``~/.local/state/wat2do/notification-pull/<date>.jsonl``.
``install-schedule`` runs it every ``interval_hours`` from ``start_hour`` to ``end_hour``
through a LaunchAgent.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services.instagram_sessions import pull  # noqa: E402

LAUNCH_AGENT_LABEL = "io.wat2do.notification-pull"
CONTROL = pull.CONTROL


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        # launchd's bare PATH has no gh (the dispatches) or adb (the emulator).
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartCalendarInterval": [
            {"Hour": hour, "Minute": CONTROL.minute}
            for hour in range(CONTROL.start_hour, CONTROL.end_hour + 1, CONTROL.interval_hours)
        ],
        # Standard, not Background: it drives the emulator, which a Background job starves.
        "ProcessType": "Standard",
        "StandardOutPath": str(pull.STATE_DIR / "pull.stdout.log"),
        "StandardErrorPath": str(pull.STATE_DIR / "pull.stderr.log"),
    }


def main() -> int:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    once = commands.add_parser("run", help="Read the silent accounts once and dispatch")
    once.add_argument("--school", action="append", default=[], help="Read only this school")
    commands.add_parser("install-schedule", help="Run it on its schedule via a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        pull.STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=CONTROL.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    for line in pull.run(schools=args.school):
        print(json.dumps(line), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
