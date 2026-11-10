#!/usr/bin/env python3
"""Forward Instagram's post notifications from the Mac's emulator to the notification workflow.

``run`` keeps every Android user that holds a school account running and sends each new
post and daily digest notification to the ``process-notification`` workflow
(``services/notification_forwarding.py``). ``run --dry-run`` only listens: it prints what
it would send and changes nothing. ``install-schedule`` keeps ``run`` alive through a
macOS LaunchAgent that logs to ``~/.local/state/wat2do/notification-forwarding``.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services import notification_forwarding  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

LAUNCH_AGENT_LABEL = "io.wat2do.notification-forwarding"


def launch_agent_payload() -> dict:
    log_path = str(notification_forwarding.LOG_PATH)
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        # gh is a Homebrew tool.
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": log_path,
        "StandardErrorPath": log_path,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Keep forwarding new notifications")
    run.add_argument(
        "--dry-run",
        action="store_true",
        help="Only listen, printing what would be sent; start no user and send nothing",
    )
    commands.add_parser("install-schedule", help="Keep run alive through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        # launchd opens the log, but does not make its folder.
        notification_forwarding.LOG_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=notification_forwarding.CONTROL.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    notification_forwarding.run_forever(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
