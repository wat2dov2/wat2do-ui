#!/usr/bin/env python3
"""Event and position ingestion through the Supabase ingestion queue.

Notified Instagram posts join the queue when GitHub records them; ``enqueue``
adds one by hand, and ``scrape-directories`` runs the Haiku directory agents.
``process`` stays running on the Mac: it fetches queued Instagram posts logged
out and turns every ready row into events and positions with Claude agents.
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
from services.ingestion.items import CONTROL  # noqa: E402

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
    commands.add_parser(
        "scrape-directories", help="Run the directory agents and queue what they find"
    )
    process = commands.add_parser(
        "process", help="Stay running and turn queued sources into events and positions"
    )
    process.add_argument("--once", action="store_true", help="Drain what is queued now, then exit")
    enqueue = commands.add_parser("enqueue", help="Queue Instagram post URLs for one school")
    enqueue.add_argument("--school", required=True)
    enqueue.add_argument("--url", action="append", required=True, dest="urls")
    commands.add_parser("status", help="Show queue counts")
    commands.add_parser("install-schedule", help="Install both macOS LaunchAgents")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if arguments.command == "install-schedule":
        install_schedule()
        return 0
    if arguments.command == "scrape-directories":
        from services.ingestion.directory_agent import scrape_directories

        result = scrape_directories()
    elif arguments.command == "process":
        from services.ingestion.processor import process_queue

        result = process_queue(wait_for_work=not arguments.once)
    elif arguments.command == "enqueue":
        from services.ingestion import items

        result = {"queued": items.queue_instagram(arguments.urls, school=arguments.school)}
    else:
        from services.ingestion import items

        result = items.counts()
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
