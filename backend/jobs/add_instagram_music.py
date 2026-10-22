#!/usr/bin/env python3
"""Add songs to published Instagram carousels from the emulator's Instagram app.

``run`` handles every carousel that has waited long enough since it published;
``install-schedule`` repeats it every few minutes through a macOS LaunchAgent
that keeps no logs.
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
from services.instagram_publishing.music import add_pending_music  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram.music"


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "run"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartInterval": controlbox.instagram_publishing.music_interval_seconds,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Add a song to every carousel that is due one")
    commands.add_parser("install-schedule", help="Repeat run through a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=controlbox.instagram_publishing.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    print(json.dumps(add_pending_music(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
