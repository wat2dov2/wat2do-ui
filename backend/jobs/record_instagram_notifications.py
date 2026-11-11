#!/usr/bin/env python3
"""Record the Instagram notifications the Mac's emulator gets, and start the workflow for
its posts.

``run`` keeps appending each new notification to
``~/.local/state/wat2do/notification-log/notifications.jsonl``
(``services/notification_recording.py``), with no direct message's text, and sends each
new post and daily digest as the phones' repository dispatch
(``services/notification_dispatch.py``). Its own status lines go to ``recorder.log`` beside it, rotated at
``log_max_bytes``. ``install-schedule`` keeps ``run`` alive through a macOS LaunchAgent.
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
from services import notification_recording  # noqa: E402

LAUNCH_AGENT_LABEL = "io.wat2do.notification-recorder"
CONTROL = notification_recording.CONTROL


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        # launchd's bare PATH has no gh, which sends the workflow dispatches.
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "KeepAlive": True,
        "ProcessType": "Background",
        # run keeps its own rotated log.
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def log_to_file() -> None:
    """Log to the terminal and to the rotated recorder.log."""
    log_path = notification_recording.LOG_PATH
    log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(),
            RotatingFileHandler(
                log_path, maxBytes=CONTROL.log_max_bytes, backupCount=CONTROL.log_backup_count
            ),
        ],
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Keep recording new notifications and dispatching posts")
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
    log_to_file()
    notification_recording.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
