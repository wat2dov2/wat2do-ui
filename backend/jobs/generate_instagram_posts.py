#!/usr/bin/env python3
"""Read Instagram candidates or save curated drafts for admin review.

``curate`` has Claude draft every school's carousel; ``install-schedule`` runs
it daily through a macOS LaunchAgent that keeps no logs.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from fastapi.encoders import jsonable_encoder

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402
from core.launch_agents import install_launch_agent  # noqa: E402
from services.instagram_publishing import (  # noqa: E402
    list_draft_candidates,
    refresh_expiring_tokens,
    save_review_draft,
)
from services.instagram_publishing.selection import DraftSelection  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram.curate"
LAUNCH_AGENT_PATH = (
    f"{Path.home() / '.local/bin'}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
)


def launch_agent_payload() -> dict:
    control = controlbox.instagram_publishing
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "curate"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": LAUNCH_AGENT_PATH},
        "StartCalendarInterval": {"Hour": control.curation_hour, "Minute": control.curation_minute},
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("candidates", help="Read enabled accounts and eligible event data")
    commands.add_parser(
        "refresh-tokens", help="Refresh expiring tokens without displaying credentials"
    )
    save = commands.add_parser("save", help="Validate and save one account's editorial choices")
    save.add_argument("selection_file", type=Path)
    commands.add_parser("curate", help="Have Claude draft every school's carousel for today")
    commands.add_parser("install-schedule", help="Run curate daily through a LaunchAgent")
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
    if args.command == "curate":
        from services.instagram_publishing.curation import curate_all

        result = curate_all()
        print(json.dumps(result, sort_keys=True))
        return 1 if result.get("failed") else 0
    if args.command == "candidates":
        result = list_draft_candidates()
    elif args.command == "refresh-tokens":
        result = refresh_expiring_tokens()
    else:
        selection = DraftSelection.model_validate_json(args.selection_file.read_text())
        result = save_review_draft(selection)
    print(json.dumps(jsonable_encoder(result), sort_keys=True))
    return 1 if args.command == "refresh-tokens" and result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
