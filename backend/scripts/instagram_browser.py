#!/usr/bin/env python3
"""Operate the Mac mini's shared Instagram browser worker and durable queues."""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import sqlite3
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Sequence

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import install_launch_agent  # noqa: E402
from services.instagram_notifications.browser_queue import (  # noqa: E402
    CONTROL,
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
    with (
        (queue.state_directory / "worker-install.lock").open("a+") as lock,
        (queue.state_directory / "ingestion.lock").open("a+") as import_lock,
    ):
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another browser worker installation is still running") from None
        try:
            fcntl.flock(import_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(
                "Wait for the current browser media import before installing"
            ) from None
        return _install_idle_worker(queue)


def _install_idle_worker(queue: BrowserJobQueue) -> dict[str, str]:
    destination = Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"
    previous_pause = queue.get_setting("paused", False)
    hold = "Browser worker installation in progress"
    if not previous_pause:
        queue.set_setting("paused", hold)
    try:
        if any(group["state"] == "running" for group in queue.status()["queues"]):
            raise RuntimeError("Wait for the current browser jobs to finish before installing")
        install_launch_agent(
            destination, launch_agent_payload(queue), timeout=CONTROL.request_timeout_seconds
        )
    finally:
        if not previous_pause:
            queue.restore_pause(hold, previous_pause)
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
        help="Process one bounded queued batch, without collecting",
    )
    worker.add_argument(
        "--no-collect",
        action="store_true",
        help="Execute queued jobs without polling published carousels",
    )
    for name in ("ingestion-sync", "ingestion-import"):
        commands.add_parser(
            name, help="Queue notification retrievals or import verified browser results"
        )
    retrieve = commands.add_parser(
        "retrieve", help="Queue a profile or post for browser extraction"
    )
    retrieve.add_argument("--school", required=True)
    retrieve.add_argument("--url", required=True)
    retrieve.add_argument("--cutoff-days", type=int, default=1)
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
    return result


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    logging.basicConfig(
        level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s", force=True
    )
    result: dict[str, Any]
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
            if arguments.command == "retry" and queue.get(arguments.job_id).kind == "retrieval":
                from services.instagram_notifications.notification_ingestion import (
                    retry_retrieved_media,
                )

                retry_retrieved_media(queue, arguments.job_id)
            else:
                getattr(queue, arguments.command)(arguments.job_id)
            result = asdict(queue.get(arguments.job_id))
        elif arguments.command in {"ingestion-sync", "ingestion-import"}:
            from services.instagram_notifications.notification_ingestion import (
                import_retrieved_media,
                sync_notification_media,
            )

            operation = (
                sync_notification_media
                if arguments.command == "ingestion-sync"
                else import_retrieved_media
            )
            result = operation(queue)
        elif arguments.command == "retrieve":
            from services import school_service
            from services.instagram_notifications.browser_session import school_account_username

            school = school_service.get_school(arguments.school)
            if school is None or not school.recipient_id:
                raise ValueError("School has no configured notification recipient")
            job_id = queue.enqueue_retrieval(
                school=school.slug,
                recipient_id=school.recipient_id,
                account_username=school_account_username(school.slug),
                url=arguments.url,
                cutoff_days=arguments.cutoff_days,
            )
            queue.set_setting(f"manual_retrieval:{job_id}", True)
            result = {"job_id": job_id}
        elif arguments.command == "sync":
            from services.instagram_notifications.carousel_engagement import (
                sync_published_carousels,
            )

            result = sync_published_carousels(queue)
        else:
            from services.instagram_notifications.carousel_engagement import get_engagement_account

            identity = get_engagement_account(arguments.school)
            result = {
                "jobs": [
                    queue.enqueue_engagement(
                        school=identity.school,
                        recipient_id=identity.recipient_id,
                        account_username=identity.account_username,
                        post_url=arguments.url,
                        dry_run=True,
                    )
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
