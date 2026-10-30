#!/usr/bin/env python3
"""Log Brave back in and rerun failed Process Notifications runs.

``run`` does one pass; ``install-schedule`` runs it daily through a macOS LaunchAgent that
keeps a small log so a persistent failure is visible.
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
from services.notification_retry.retry import STATE_DIRECTORY  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.notification-retry"


def launch_agent_payload() -> dict:
    control = controlbox.notification_retry
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartCalendarInterval": {
            "Hour": control.schedule_hour,
            "Minute": control.schedule_minute,
        },
        "ProcessType": "Background",
        "StandardOutPath": str(STATE_DIRECTORY / "retry.stdout.log"),
        "StandardErrorPath": str(STATE_DIRECTORY / "retry.stderr.log"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Recover the Brave login and rerun failed runs once")
    commands.add_parser("install-schedule", help="Run daily through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=controlbox.notification_retry.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    from services.notification_retry import retry_failed_notifications

    result = retry_failed_notifications()
    print(json.dumps(result, sort_keys=True))
    return 1 if result.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
