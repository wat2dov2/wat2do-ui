#!/usr/bin/env python3
"""Operate the Mac mini's shared Instagram browser worker and durable queues."""

from __future__ import annotations

import argparse
import json
import logging
import os
import plistlib
import sqlite3
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Sequence

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from services.instagram_notifications.browser_queue import (  # noqa: E402
    CONTROL,
    ENGAGEMENT_ACTIONS,
    BrowserJobQueue,
)
from services.instagram_notifications.browser_session import BrowserSessionError  # noqa: E402
from services.instagram_notifications.browser_worker import run_worker  # noqa: E402

LAUNCH_AGENT_LABEL = "io.wat2do.instagram-browser.worker"


def launch_agent_payload(queue: BrowserJobQueue) -> dict[str, Any]:
    """Keep the stable checkout and the same user's spool across runner checkouts."""
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [
            sys.executable,
            str(Path(__file__).resolve()),
            "--state-directory",
            str(queue.state_directory.resolve()),
            "worker",
        ],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONUNBUFFERED": "1",
        },
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": str(queue.state_directory / "worker.stdout.log"),
        "StandardErrorPath": str(queue.state_directory / "worker.stderr.log"),
    }


def install(queue: BrowserJobQueue) -> dict[str, str]:
    if sys.platform != "darwin":
        raise ValueError("The Instagram browser worker requires macOS and an existing Brave tab")
    destination = Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(plistlib.dumps(launch_agent_payload(queue), sort_keys=True))
    destination.chmod(0o600)
    domain = f"gui/{os.getuid()}"
    commands = [
        ["launchctl", "bootout", domain, str(destination)],
        ["launchctl", "enable", f"{domain}/{LAUNCH_AGENT_LABEL}"],
        ["launchctl", "bootstrap", domain, str(destination)],
    ]
    for index, command in enumerate(commands):
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=CONTROL.request_timeout_seconds
        )
        if index and result.returncode:
            raise RuntimeError(
                f"Could not {command[1]} Instagram browser LaunchAgent (exit {result.returncode})"
            )
    return {"installed": LAUNCH_AGENT_LABEL, "plist": str(destination)}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--state-directory", type=Path, help="Defaults to the current user's shared state directory"
    )
    commands = result.add_subparsers(dest="command", required=True)
    worker = commands.add_parser(
        "worker", help="Run the single browser executor and published-carousel collector"
    )
    worker.add_argument(
        "--once",
        action="store_true",
        help="Process at most one already queued job, without collecting",
    )
    worker.add_argument(
        "--no-collect",
        action="store_true",
        help="Execute queued jobs without polling published carousels",
    )
    commands.add_parser("install", help="Install and start the macOS worker LaunchAgent")
    status = commands.add_parser("status", help="Show worker health and queue quantities by school")
    status.add_argument("--job-id", help="Inspect the full result of one job")
    commands.add_parser(
        "sync", help="Queue original posts from newly published carousel selections"
    )
    commands.add_parser("pause", help="Pause browser work after the current job finishes")
    commands.add_parser("resume", help="Resume after inspecting any uncertain browser activity")
    for command in ("retry", "cancel"):
        operation = commands.add_parser(command)
        operation.add_argument("--job-id", required=True)
    inspect = commands.add_parser(
        "inspect", help="Queue read-only action checks in the shared browser"
    )
    inspect.add_argument("--school", required=True)
    inspect.add_argument("--url", required=True)
    inspect.add_argument("--action", action="append", choices=sorted(ENGAGEMENT_ACTIONS))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    logging.basicConfig(
        level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s", force=True
    )
    try:
        queue = BrowserJobQueue(arguments.state_directory)
        if arguments.command == "worker":
            run_worker(
                queue, once=arguments.once, collect=not arguments.no_collect and not arguments.once
            )
            return 0
        if arguments.command == "install":
            result = install(queue)
        elif arguments.command == "status":
            if arguments.job_id:
                job = queue.get(arguments.job_id)
                if job is None:
                    raise ValueError("Instagram browser job does not exist")
                result = asdict(job)
            else:
                result = queue.status()
        elif arguments.command in {"pause", "resume"}:
            queue.set_setting("paused", arguments.command == "pause")
            result = {"paused": queue.get_setting("paused")}
        elif arguments.command in {"retry", "cancel"}:
            if queue.get(arguments.job_id) is None:
                raise ValueError("Instagram browser job does not exist")
            getattr(queue, arguments.command)(arguments.job_id)
            result = asdict(queue.get(arguments.job_id))
        elif arguments.command == "sync":
            from services.instagram_notifications.carousel_engagement import (
                sync_published_carousels,
            )

            result = sync_published_carousels(queue)
        else:
            from services.instagram_notifications.carousel_engagement import get_engagement_account

            identity = get_engagement_account(arguments.school)
            actions = list(dict.fromkeys(arguments.action or CONTROL.actions))
            result = {
                "jobs": [
                    queue.enqueue_engagement(
                        school=identity.school,
                        recipient_id=identity.recipient_id,
                        account_username=identity.account_username,
                        post_url=arguments.url,
                        action=action,
                        dry_run=True,
                    )
                    for action in actions
                ]
            }
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (ValueError, BrowserSessionError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
    except (OSError, sqlite3.Error, subprocess.SubprocessError) as exc:
        print(f"Instagram browser operation failed ({type(exc).__name__})", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
