#!/usr/bin/env python3
"""Forward Instagram's post notifications from the Mac's emulator to the notification workflow.

``run`` keeps the Android users that hold school accounts running and sends each new post
and daily digest notification to the ``process-notification`` workflow
(``services/notification_forwarding.py``), logging to
``~/.local/state/wat2do/notification-forwarding/forwarder.log``, which is rotated at
``log_max_bytes``. ``run --dry-run`` only listens: it prints what it would send and
changes nothing. ``install-schedule`` keeps ``run`` alive through a macOS LaunchAgent.
"""

from __future__ import annotations

import argparse
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services import notification_forwarding  # noqa: E402

LAUNCH_AGENT_LABEL = "io.wat2do.notification-forwarding"
CONTROL = notification_forwarding.CONTROL


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        # gh is a Homebrew tool.
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "KeepAlive": True,
        "ProcessType": "Background",
        # run keeps its own rotated log.
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def log_to(*, dry_run: bool) -> None:
    """Log to the terminal, and for a real run also to the rotated forwarder.log."""
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if not dry_run:
        notification_forwarding.LOG_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        handlers.append(
            RotatingFileHandler(
                notification_forwarding.LOG_PATH,
                maxBytes=CONTROL.log_max_bytes,
                backupCount=CONTROL.log_backup_count,
            )
        )
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers
    )


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
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=CONTROL.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    log_to(dry_run=args.dry_run)
    notification_forwarding.run_forever(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
