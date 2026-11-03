#!/usr/bin/env python3
"""Event and position ingestion through the database's ingestion queue.

Notified Instagram posts join the queue when GitHub records them; ``enqueue``
adds one by hand, and ``scrape-directories`` runs the Haiku directory agents. The always-on processor
that fetches queued posts and runs the ingestion agents is Rust
(``rust/src/bin/wat2do-ingest.rs``); ``install-schedule`` installs it and the
directory scrape as macOS LaunchAgents, which keep no logs.
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

from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services.ingestion.items import CONTROL  # noqa: E402

REPOSITORY_DIRECTORY = BACKEND_DIRECTORY.parent
# cargo builds the checkout's processor on every start, so a moved runtime
# checkout runs its own code and prompt after a kickstart.
CARGO_PATH = Path.home() / ".cargo/bin/cargo"
PROCESS_COMMAND = [
    str(CARGO_PATH),
    "run",
    "--release",
    "--quiet",
    "--manifest-path",
    str(REPOSITORY_DIRECTORY / "rust/Cargo.toml"),
    "--bin",
    "wat2do-ingest",
    "--",
    "process",
]

# The processor stays running (no interval); the directory scrape repeats.
LAUNCH_AGENTS: dict[str, tuple[str, int | None]] = {
    "process": ("io.wat2do.ingestion.process", None),
    "scrape-directories": (
        "io.wat2do.ingestion.directories",
        CONTROL.directory_scrape_interval_seconds,
    ),
}


def launch_agent_payload(command: str) -> dict[str, Any]:
    label, interval = LAUNCH_AGENTS[command]
    return {
        "Label": label,
        "ProgramArguments": PROCESS_COMMAND
        if command == "process"
        else [sys.executable, str(Path(__file__).resolve()), command],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": f"{CARGO_PATH.parent}:{CLAUDE_CODE_PATH}"},
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
