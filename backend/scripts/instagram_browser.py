#!/usr/bin/env python3
"""Operate the Mac mini's shared Instagram browser worker and durable queues."""

from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from dataclasses import asdict
from io import TextIOWrapper
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Sequence

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402
from core.launch_agents import LaunchAgentRecoveryError, install_launch_agent  # noqa: E402
from services.instagram_notifications.browser_queue import (  # noqa: E402
    CONTROL,
    WORKER_INSTALLATION_PAUSE,
    BrowserJobQueue,
)
from services.instagram_notifications.browser_session import BrowserSessionError  # noqa: E402
from services.instagram_notifications.browser_worker import run_worker  # noqa: E402

LAUNCH_AGENT_LABEL = "io.wat2do.instagram-browser.worker"
LOG_FORMAT = "%(levelname)s %(name)s: %(message)s"


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_review_storage_capacity(queue: BrowserJobQueue, directory: Path) -> None:
    with closing(queue._connect()) as db:
        logical_bytes = (
            db.execute("PRAGMA page_count").fetchone()[0]
            * db.execute("PRAGMA page_size").fetchone()[0]
        )
    required = max(logical_bytes, queue.database_path.stat().st_size) * 2 + (
        controlbox.notification_workflow.minimum_free_disk_mb * 1024 * 1024
    )
    if shutil.disk_usage(directory).free < required:
        raise RuntimeError(
            "Review maintenance needs more free disk space; existing evidence is unchanged"
        )


def _backup_review_storage(queue: BrowserJobQueue, directory: Path) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink() or any(parent.is_symlink() for parent in directory.parents):
        raise ValueError("Review backup ownership is invalid")
    directory.chmod(0o700)
    _require_review_storage_capacity(queue, directory)
    destination = directory / "latest-before-review-compaction.sqlite3.gz"
    with tempfile.TemporaryDirectory(prefix=".review-backup-", dir=directory) as staging:
        snapshot = Path(staging) / "queue.sqlite3"
        with closing(queue._connect()) as source, closing(sqlite3.connect(snapshot)) as target:
            source.backup(target)
        snapshot.chmod(0o600)
        digest = _file_hash(snapshot)
        compressed = Path(staging) / "queue.sqlite3.gz"
        with compressed.open("wb") as handle:
            compressed.chmod(0o600)
            with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=6, mtime=0) as archive:
                with snapshot.open("rb") as source:
                    shutil.copyfileobj(source, archive)
            handle.flush()
            os.fsync(handle.fileno())
        verified = hashlib.sha256()
        with gzip.open(compressed, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                verified.update(chunk)
        if verified.hexdigest() != digest:
            raise RuntimeError("Review backup verification failed; existing evidence is unchanged")
        compressed.replace(destination)
    return {"backup": str(destination), "uncompressed_sha256": digest}


def compact_review_storage(
    queue: BrowserJobQueue,
    *,
    backup_directory: Path,
    artifacts_directory: Path | None = None,
    protected_patterns: Sequence[str] = (),
    vacuum: bool = False,
) -> dict[str, Any]:
    """Keep source evidence byte-exact while replacing its redundant storage."""
    import fnmatch

    with (
        (queue.state_directory / "worker-install.lock").open("a+") as install_lock,
        (queue.state_directory / "ingestion.lock").open("a+") as import_lock,
        (queue.state_directory / "worker.lock").open("a+") as worker_lock,
    ):
        for lock in (install_lock, import_lock, worker_lock):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError(
                    "Review compaction requires idle, stopped worker and import processes"
                ) from None
        if not queue.get_setting("paused", False):
            raise RuntimeError("Review compaction requires an existing maintenance admission hold")
        result = _backup_review_storage(queue, backup_directory)
        result["settings"] = queue.compact_review_settings()
        stats = {"compacted": 0, "already_compact": 0, "protected": 0, "changed": 0}
        if artifacts_directory is not None:
            for path in sorted(artifacts_directory.glob("notification*.json")):
                if any(fnmatch.fnmatch(path.name, pattern) for pattern in protected_patterns):
                    stats["protected"] += 1
                    continue
                if path.is_symlink():
                    raise ValueError("Review artifact ownership is invalid")
                raw = path.read_bytes()
                original = queue.review_artifact_bytes(path)
                if raw != original:
                    stats["already_compact"] += 1
                    continue
                # Small summaries do not cause the measured disk amplification.
                if len(original) < CONTROL.review_snapshot_chunk_bytes:
                    continue
                if queue.write_review_artifact(
                    path,
                    original.decode("utf-8"),
                    expected_sha256=hashlib.sha256(original).hexdigest(),
                ):
                    if queue.review_artifact_bytes(path) != original:
                        raise RuntimeError(
                            "Review artifact readback failed; preserve the maintenance hold"
                        )
                    stats["compacted"] += 1
                else:
                    stats["changed"] += 1
        result["artifacts"] = stats
        result["artifact_inventory"] = queue.inventory_review_artifacts()
        result["review_storage"] = queue.maintain_review_storage(
            force=True, _ingestion_lock=import_lock
        )
        if vacuum:
            _require_review_storage_capacity(queue, queue.state_directory)
            with closing(queue._connect()) as db:
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                db.execute("PRAGMA auto_vacuum=INCREMENTAL")
                db.execute("VACUUM")
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Review database integrity verification failed")
        result["database_bytes"] = queue.database_path.stat().st_size
        return result


class _WorkerOperationalLogHandler(RotatingFileHandler):
    """Bound worker logs without amplifying disk failures onto launchd stderr."""

    def __init__(self, filename: Path, *, max_bytes: int, backup_count: int) -> None:
        self._write_failed = False
        self._failure_reported = False
        super().__init__(
            filename,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
            errors="backslashreplace",
            delay=True,
        )

    def _open(self) -> TextIOWrapper:
        descriptor = os.open(
            self.baseFilename, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600
        )
        try:
            os.fchmod(descriptor, 0o600)
            return os.fdopen(descriptor, "a", encoding="utf-8", errors="backslashreplace")
        except BaseException:
            os.close(descriptor)
            raise

    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)
        encoded = rendered.encode("utf-8", errors="backslashreplace")
        limit = self.maxBytes - len(self.terminator.encode("utf-8"))
        if len(encoded) <= limit:
            return rendered
        suffix = "[truncated]"
        prefix = encoded[: limit - len(suffix)].decode("utf-8", errors="ignore")
        return prefix + suffix

    def shouldRollover(self, record: logging.LogRecord) -> bool:
        stream = self.stream
        if stream is None:
            stream = self._open()
            self.stream = stream
        stream.seek(0, os.SEEK_END)
        message = (self.format(record) + self.terminator).encode("utf-8", errors="backslashreplace")
        return stream.tell() + len(message) > self.maxBytes

    def emit(self, record: logging.LogRecord) -> None:
        self._write_failed = False
        super().emit(record)
        if not self._write_failed:
            self._failure_reported = False

    def handleError(self, record: logging.LogRecord) -> None:
        self._write_failed = True
        if self._failure_reported:
            return
        self._failure_reported = True
        try:
            sys.stderr.write(
                "Instagram worker operational log is unavailable; logging will retry.\n"
            )
            sys.stderr.flush()
        except (OSError, ValueError):
            pass


def configure_worker_logging(state_directory: Path) -> None:
    handler = _WorkerOperationalLogHandler(
        state_directory / "worker.operations.log",
        max_bytes=CONTROL.worker_log_max_bytes,
        backup_count=CONTROL.worker_log_backup_count,
    )
    logging.basicConfig(level=logging.WARNING, format=LOG_FORMAT, handlers=[handler], force=True)


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
    hold = WORKER_INSTALLATION_PAUSE
    if not queue.compare_set_pause(previous_pause, hold):
        raise RuntimeError("Browser worker pause changed during setup; inspect before retrying")
    try:
        if any(group["state"] == "running" for group in queue.status()["queues"]):
            raise RuntimeError("Wait for the current browser jobs to finish before installing")
        install_launch_agent(
            destination,
            launch_agent_payload(queue),
            timeout=CONTROL.request_timeout_seconds,
            poll_interval_seconds=CONTROL.worker_poll_interval_seconds,
        )
    except LaunchAgentRecoveryError:
        queue.compare_set_pause(
            hold,
            previous_pause
            or "Browser worker installation recovery is uncertain; inspect before resuming",
        )
        raise
    finally:
        queue.compare_set_pause(hold, previous_pause)
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
    for name in ("ingestion-sync", "ingestion-ready", "ingestion-import"):
        commands.add_parser(
            name, help="Queue retrievals, preview fair review targets, or import verified results"
        )
    retrieve = commands.add_parser(
        "retrieve", help="Queue a profile or post for browser extraction"
    )
    retrieve.add_argument("--school", required=True)
    retrieve.add_argument("--url", required=True)
    retrieve.add_argument("--cutoff-days", type=int, default=1)
    commands.add_parser("install", help="Install and start the macOS worker LaunchAgent")
    compact = commands.add_parser(
        "compact-review-storage",
        help="Losslessly compact backed-up review evidence while the worker is stopped",
    )
    compact.add_argument("--backup-directory", type=Path, required=True)
    compact.add_argument("--artifacts-directory", type=Path)
    compact.add_argument("--protect", action="append", default=[])
    compact.add_argument("--vacuum", action="store_true")
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
    logging.basicConfig(level=logging.WARNING, format=LOG_FORMAT, force=True)
    result: dict[str, Any]
    try:
        queue = BrowserJobQueue(arguments.state_directory)
        if arguments.command == "worker":
            configure_worker_logging(queue.state_directory)
            run_worker(
                queue, once=arguments.once, collect=not arguments.no_collect and not arguments.once
            )
            return 0
        if arguments.command == "install":
            result = install(queue)
        elif arguments.command == "compact-review-storage":
            result = compact_review_storage(
                queue,
                backup_directory=arguments.backup_directory,
                artifacts_directory=arguments.artifacts_directory,
                protected_patterns=arguments.protect,
                vacuum=arguments.vacuum,
            )
        elif arguments.command == "status":
            if arguments.job_id:
                job = queue.get(arguments.job_id)
                if job is None:
                    raise ValueError("Instagram browser job does not exist")
                result = asdict(job)
            else:
                result = queue.status()
        elif arguments.command in {"pause", "resume"}:
            if arguments.command == "resume":
                prior_pause = queue.get_setting("paused", False)
                if prior_pause == WORKER_INSTALLATION_PAUSE:
                    raise RuntimeError("Wait for browser worker installation before resuming")
                if not queue.compare_set_pause(prior_pause, False):
                    raise RuntimeError("Browser worker pause changed; inspect before resuming")
            else:
                queue.set_setting("paused", True)
            result = {"paused": queue.get_setting("paused")}
        elif arguments.command in {"retry", "cancel"}:
            job = queue.get(arguments.job_id)
            if job is None:
                raise ValueError("Instagram browser job does not exist")
            if arguments.command == "retry" and job.kind == "retrieval":
                from services.instagram_notifications.notification_ingestion import (
                    retry_retrieved_media,
                )

                retry_retrieved_media(queue, arguments.job_id)
            else:
                getattr(queue, arguments.command)(arguments.job_id)
            updated_job = queue.get(arguments.job_id)
            if updated_job is None:
                raise RuntimeError("Instagram browser job disappeared during the operation")
            result = asdict(updated_job)
        elif arguments.command in {"ingestion-sync", "ingestion-ready", "ingestion-import"}:
            from services.instagram_notifications.notification_ingestion import (
                import_retrieved_media,
                ready_review_targets,
                sync_notification_media,
            )

            operation = {
                "ingestion-sync": sync_notification_media,
                "ingestion-ready": ready_review_targets,
                "ingestion-import": import_retrieved_media,
            }[arguments.command]
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
        if arguments.command == "ingestion-import" and any(
            result.get(key, 0) for key in ("failed", "blocked", "invalid", "busy")
        ):
            return 1
        return 0
    except (ValueError, BrowserSessionError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
    except (OSError, sqlite3.Error, subprocess.SubprocessError) as exc:
        print(f"Instagram browser operation failed ({type(exc).__name__})", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
