#!/usr/bin/env python3
"""Read Instagram candidates or save curated drafts for admin review.

``curate`` has Claude draft every school's carousel; ``publish`` posts every
ready draft for today; ``install-schedule`` runs both daily through macOS
LaunchAgents that keep no logs.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi.encoders import jsonable_encoder

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402
from core.launch_agents import CLAUDE_CODE_PATH, install_launch_agent  # noqa: E402
from services.instagram_publishing import (  # noqa: E402
    list_draft_candidates,
    publish_ready_drafts,
    save_review_draft,
)
from services.instagram_publishing.selection import DraftSelection  # noqa: E402

logging.basicConfig(level=logging.INFO)

LAUNCH_AGENT_LABEL = "io.wat2do.instagram.curate"
PUBLISH_LAUNCH_AGENT_LABEL = "io.wat2do.instagram.publish"
# Curation and publishing take turns, so a publish run never misses a draft
# that is still being written.
LOCK_PATH = Path(tempfile.gettempdir()) / "wat2do-instagram-carousels.lock"


def launch_agent_payload() -> dict:
    control = controlbox.instagram_publishing
    return _payload(
        LAUNCH_AGENT_LABEL,
        "curate",
        [{"Hour": hour, "Minute": control.curation_minute} for hour in control.curation_hours],
    )


def publish_launch_agent_payload() -> dict:
    control = controlbox.instagram_publishing
    return _payload(
        PUBLISH_LAUNCH_AGENT_LABEL,
        "publish",
        [{"Hour": control.auto_publish_hour, "Minute": control.auto_publish_minute}],
    )


def _payload(label: str, command: str, times: list[dict[str, int]]) -> dict:
    return {
        "Label": label,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), command],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {"PATH": CLAUDE_CODE_PATH},
        "StartCalendarInterval": times,
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


@contextmanager
def _carousel_lock() -> Iterator[None]:
    with LOCK_PATH.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("candidates", help="Read enabled accounts and eligible event data")
    save = commands.add_parser("save", help="Validate and save one account's editorial choices")
    save.add_argument("selection_file", type=Path)
    commands.add_parser("curate", help="Have Claude draft every school's carousel for today")
    commands.add_parser("publish", help="Publish every school's ready draft for today")
    commands.add_parser(
        "install-schedule", help="Run curate and publish daily through LaunchAgents"
    )
    args = parser.parse_args()
    if args.command == "install-schedule":
        for payload in (launch_agent_payload(), publish_launch_agent_payload()):
            install_launch_agent(
                Path.home() / "Library/LaunchAgents" / f"{payload['Label']}.plist",
                payload,
                timeout=controlbox.instagram_publishing.launch_agent_timeout_seconds,
                poll_interval_seconds=1,
            )
            print(f"Installed {payload['Label']}")
        return 0
    if args.command == "curate":
        from services.instagram_publishing.curation import curate_all

        with _carousel_lock():
            result = curate_all()
        print(json.dumps(result, sort_keys=True))
        return 1 if result.get("failed") else 0
    if args.command == "publish":
        with _carousel_lock():
            result = publish_ready_drafts()
        print(json.dumps(result, sort_keys=True))
        return 1 if result.get("failed") or result.get("skipped") else 0
    if args.command == "candidates":
        result = list_draft_candidates()
    else:
        selection = DraftSelection.model_validate_json(args.selection_file.read_text())
        result = save_review_draft(selection)
    print(json.dumps(jsonable_encoder(result), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
