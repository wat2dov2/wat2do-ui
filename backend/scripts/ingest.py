#!/usr/bin/env python3
"""Local event and position ingestion.

Producers capture sources into the local queue: the Instagram browser worker
queues retrieved posts, and ``scrape-directories`` queues official directory
pages. ``process`` stays running and turns queued captures into events and
positions with Claude agents as soon as they are queued, whatever their source.
``install-schedule`` installs both macOS LaunchAgents; they keep no logs.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import install_launch_agent  # noqa: E402
from services.ingestion.queue import CONTROL, IngestionQueue  # noqa: E402

# The processor stays running (no interval); the directory scrape repeats.
LAUNCH_AGENTS: dict[str, tuple[str, int | None]] = {
    "process": ("io.wat2do.ingestion.process", None),
    "scrape-directories": (
        "io.wat2do.ingestion.directories",
        CONTROL.directory_scrape_interval_seconds,
    ),
}
LAUNCH_AGENT_PATH = (
    f"{Path.home() / '.local/bin'}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
)


def launch_agent_payload(command: str) -> dict[str, Any]:
    label, interval = LAUNCH_AGENTS[command]
    return {
        "Label": label,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), command],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": LAUNCH_AGENT_PATH},
        "RunAtLoad": True,
        **({"StartInterval": interval} if interval else {"KeepAlive": True}),
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def install_schedule() -> None:
    for command in LAUNCH_AGENTS:
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENTS[command][0]}.plist",
            launch_agent_payload(command),
            timeout=CONTROL.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        label, interval = LAUNCH_AGENTS[command]
        print(f"Installed {label} " + (f"every {interval} seconds" if interval else "(always on)"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("scrape-directories", help="Queue new official directory pages")
    process = commands.add_parser(
        "process", help="Stay running and turn queued captures into events and positions"
    )
    process.add_argument("--once", action="store_true", help="Drain what is queued now, then exit")
    commands.add_parser("status", help="Show queue counts")
    commands.add_parser("install-schedule", help="Install both macOS LaunchAgents")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    queue = IngestionQueue()
    if arguments.command == "install-schedule":
        install_schedule()
        return 0
    if arguments.command == "scrape-directories":
        from services.ingestion.directory import scrape_directories

        result = scrape_directories(queue)
    elif arguments.command == "process":
        from services.ingestion.processor import process_queue

        result = process_queue(queue, wait_for_work=not arguments.once)
    else:
        result = queue.counts()
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
