#!/usr/bin/env python3
"""Find public complaints about competitors for the admin page.

``sweep`` has Claude Haiku search each competitor once, then has Opus write
the daily report on what it found; ``report`` writes only the report.
``install-schedule`` runs ``sweep`` daily through a LaunchAgent that keeps no
logs.
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

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.competitor-pain-points"


def launch_agent_payload() -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "sweep"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartInterval": controlbox.competitor_pain_points.sweep_interval_hours * 3600,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("sweep", help="Search every competitor once and store new complaints")
    commands.add_parser("report", help="Write today's report on the complaints found so far")
    commands.add_parser("install-schedule", help="Run sweep daily via a LaunchAgent")
    args = parser.parse_args()
    if args.command == "install-schedule":
        install_launch_agent(
            Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist",
            launch_agent_payload(),
            timeout=controlbox.competitor_pain_points.launch_agent_timeout_seconds,
            poll_interval_seconds=1,
        )
        print(f"Installed {LAUNCH_AGENT_LABEL}")
        return 0
    from services.competitor_pain_points.finder import sweep

    result = sweep() if args.command == "sweep" else {"failed": []}
    result["report"] = _report()
    print(json.dumps(result, sort_keys=True))
    return 1 if result["failed"] or result["report"] == "failed" else 0


def _report() -> str:
    """Write the daily report; a failure is logged and leaves the sweep's findings stored."""
    from pydantic import ValidationError

    from services.claude_code import ClaudeCodeError
    from services.competitor_pain_points.report import write_daily_report

    try:
        report = write_daily_report()
    except (ClaudeCodeError, ValidationError):
        logging.exception("Daily pain point report failed")
        return "failed"
    return "written" if report else "nothing new"


if __name__ == "__main__":
    sys.exit(main())
