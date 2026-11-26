#!/usr/bin/env python3
"""Keep the Mac's wat2do jobs healthy without a person in the loop.

``watchdog`` checks hard numbers (ingestion volume, the Brave worker, the recorder,
the Handle notification runs, runners, the emulator, disk, LaunchAgents, today's
carousels, Graph tokens, both Claude logins), appends them to
``~/.local/state/wat2do/maintenance/watchdog.jsonl`` and starts the maintenance agent
at once when one is red. ``agent`` runs the maintenance agent (Claude Code on the
second login, prompt ``maintenance/prompt.md`` in the local prompts folder), which
fixes what it can and writes ``~/Desktop/wat2do-reports/health-<date>.html``;
``--dry-run`` only looks. ``install-schedule`` runs the watchdog hourly and the agent
every day at ``controlbox/maintenance.json`` ``agent_hour``.
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
from services.maintenance import watchdog  # noqa: E402

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)

CONTROL = controlbox.maintenance
LOG_DIRECTORY = watchdog.STATE_DIR


def launch_agent_payloads() -> list[dict]:
    base = {
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
    }
    return [
        {
            **base,
            "Label": watchdog.WATCHDOG_LABEL,
            "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "watchdog"],
            "StartInterval": CONTROL.watchdog_interval_minutes * 60,
            "RunAtLoad": True,
            "ProcessType": "Background",
            "StandardOutPath": str(LOG_DIRECTORY / "watchdog.stdout.log"),
            "StandardErrorPath": str(LOG_DIRECTORY / "watchdog.stderr.log"),
        },
        {
            **base,
            "Label": watchdog.AGENT_LABEL,
            "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "agent"],
            "StartCalendarInterval": {"Hour": CONTROL.agent_hour, "Minute": CONTROL.agent_minute},
            # Its builds and emulator work must not be starved the way Background jobs are.
            "ProcessType": "Standard",
            "StandardOutPath": str(LOG_DIRECTORY / "agent.stdout.log"),
            "StandardErrorPath": str(LOG_DIRECTORY / "agent.stderr.log"),
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    watch = commands.add_parser("watchdog", help="Check everything once; start the agent on red")
    watch.add_argument("--no-trigger", action="store_true", help="Only check and log")
    agent = commands.add_parser("agent", help="Run the maintenance agent once")
    agent.add_argument("--dry-run", action="store_true", help="Look and report, change nothing")
    commands.add_parser("install-schedule", help="Install the hourly watchdog and the daily agent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        LOG_DIRECTORY.mkdir(parents=True, exist_ok=True)
        for payload in launch_agent_payloads():
            install_launch_agent(
                Path.home() / "Library/LaunchAgents" / f"{payload['Label']}.plist",
                payload,
                timeout=CONTROL.launch_agent_timeout_seconds,
                poll_interval_seconds=1,
            )
            print(f"Installed {payload['Label']}")
        return 0
    if args.command == "watchdog":
        record = watchdog.check(trigger=not args.no_trigger)
        print(
            json.dumps(
                {
                    "at": record["at"],
                    "status": record["status"],
                    "triggered": record.get("triggered", []),
                }
            )
        )
        return 0
    from services.maintenance import agent as maintenance_agent

    entry = maintenance_agent.run(dry_run=args.dry_run)
    print(
        json.dumps({key: entry.get(key) for key in ("status", "summary", "report_path", "skipped")})
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
