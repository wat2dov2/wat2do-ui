"""Bridge the production notification ledger to the shared Mac browser queue.

Retrieval never claims database media. Import claims only after verified post
fields are ready, journals its token before the network write, and releases
interrupted imports on the next scheduled run under a singleton import lock.
"""

from __future__ import annotations

import fcntl
import time
from collections import defaultdict
from uuid import uuid4

from core.constants import WORKFLOW_RUN_ERROR
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import INSTAGRAM_NOTIFICATION_MEDIA, INSTAGRAM_NOTIFICATIONS
from services import school_service
from services.instagram_notifications.browser_ingestion import canonical_target_url
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import school_account_username
from services.instagram_notifications.ledger import (
    claim_pending_browser_media,
    mark_media_succeeded,
    rollback_media_claim,
)
from services.scraper.pipeline import run_pipeline

_CONTROL = controlbox.instagram_browser
_JOURNAL = "notification_browser_import_claim"


def _pending_rows() -> list[dict]:
    def page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(INSTAGRAM_NOTIFICATION_MEDIA)
            .select(f"id,source_url,notification:{INSTAGRAM_NOTIFICATIONS}(intended_recipient_id)")
            .eq("status", "pending")
            .order("created_at")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )

    return fetch_all_pages(page)


def _identity(row: dict) -> tuple[str, str, str]:
    recipient = row["notification"]["intended_recipient_id"]
    school = school_service.get_school_by_recipient_id(recipient)
    if school is None:
        raise ValueError("Notification recipient has no configured school")
    return school.slug, recipient, school_account_username(school.slug)


def sync_notification_media(queue: BrowserJobQueue) -> dict[str, int]:
    stats = {"pending_media": 0, "queued": 0}
    for row in _pending_rows():
        school, recipient, username = _identity(row)
        if queue.account_excluded(username):
            continue
        job_id = queue.enqueue_retrieval(
            school=school,
            recipient_id=recipient,
            account_username=username,
            url=row["source_url"],
        )
        stats["pending_media"] += 1
        job = queue.get(job_id)
        if (
            job
            and job.state in {"failed", "cancelled"}
            and job.attempts < _CONTROL.ingestion_retry_limit
        ):
            queue.refresh_retrieval(job.id)
        if job and job.state == "pending":
            stats["queued"] += 1
    queue.set_setting("notification_source_status", {"checked_at": time.time(), **stats})
    return stats


def import_retrieved_media(queue: BrowserJobQueue) -> dict[str, int]:
    stats = {"imported": 0, "waiting": 0, "failed": 0, "recovered": 0, "blocked": 0}
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**stats, "busy": 1}
        prior = queue.get_setting(_JOURNAL)
        if prior:
            stats["recovered"] += int(rollback_media_claim(**prior))
            queue.set_setting(_JOURNAL, None)
        for row in _pending_rows():
            if stats["imported"] + stats["failed"] >= _CONTROL.ingestion_batch_size:
                break
            school, recipient, username = _identity(row)
            if queue.account_excluded(username):
                continue
            job_id = queue.enqueue_retrieval(
                school=school,
                recipient_id=recipient,
                account_username=username,
                url=row["source_url"],
            )
            job = queue.get(job_id)
            if not job or job.state != "succeeded" or not job.result:
                stats["waiting"] += 1
                continue
            if job.result.get("target_url") != canonical_target_url(row["source_url"]):
                raise ValueError("Retrieved media does not match notification target")
            attempts_key = f"notification_import_attempts:{row['id']}"
            attempts = queue.get_setting(attempts_key, 0)
            if attempts >= _CONTROL.ingestion_retry_limit:
                stats["blocked"] += 1
                continue
            claim = {"media_row_id": row["id"], "claim_token": str(uuid4())}
            queue.set_setting(_JOURNAL, claim)
            # If the request raises, keep the journal for the next run to recover.
            if not claim_pending_browser_media(**claim):
                queue.set_setting(_JOURNAL, None)
                continue
            queue.set_setting(attempts_key, attempts + 1)
            try:
                _import_posts(school, job.result["posts"], exact=True)
                if not mark_media_succeeded(**claim):
                    raise RuntimeError("Browser media import could not finalize its claim")
            except Exception:
                # Signed media URLs may have expired while waiting for editorial import.
                # Keep the ledger pending and refresh public details on the next run.
                rollback_media_claim(**claim)
                queue.refresh_retrieval(job.id)
                queue.set_setting(
                    "notification_import_error", {"media_row_id": row["id"], "job_id": job.id}
                )
                stats["failed"] += 1
            else:
                stats["imported"] += 1
            queue.set_setting(_JOURNAL, None)
        _import_manual_targets(queue, stats)
    queue.set_setting("notification_import_status", {"checked_at": time.time(), **stats})
    return stats


def _import_posts(school: str, posts: list[dict], *, exact: bool) -> None:
    if exact and len(posts) != 1:
        raise ValueError("An exact notification must retrieve exactly one post")
    by_owner: dict[str, list[dict]] = defaultdict(list)
    for post in posts:
        by_owner[post["ownerUsername"]].append(post)
    for owner, owned in by_owner.items():
        result = run_pipeline(
            ig_handle=owner,
            school=school,
            posts=owned,
            cutoff_days=1825,
            dry_run=False,
            allow_past_events=False,
        )
        if result.status == WORKFLOW_RUN_ERROR:
            raise RuntimeError("Retrieved Instagram post extraction failed")


def _import_manual_targets(queue: BrowserJobQueue, stats: dict[str, int]) -> None:
    for job in queue.retrieval_results():
        if queue.account_excluded(job.account_username) or not queue.get_setting(
            f"manual_retrieval:{job.id}"
        ):
            continue
        key = f"manual_imported:{job.id}"
        if (
            queue.get_setting(key)
            or stats["imported"] + stats["failed"] >= _CONTROL.ingestion_batch_size
        ):
            continue
        if not job.result or job.result.get("target_url") != job.payload["url"]:
            raise ValueError("Retrieved profile does not match its job")
        attempts_key = f"manual_import_attempts:{job.id}"
        attempts = queue.get_setting(attempts_key, 0)
        if attempts >= _CONTROL.ingestion_retry_limit:
            stats["blocked"] += 1
            continue
        queue.set_setting(attempts_key, attempts + 1)
        try:
            _import_posts(job.school, job.result["posts"], exact=False)
        except Exception:
            queue.refresh_retrieval(job.id)
            queue.set_setting("notification_import_error", {"job_id": job.id})
            stats["failed"] += 1
        else:
            queue.set_setting(key, True)
            stats["imported"] += 1


def retry_retrieved_media(queue: BrowserJobQueue, job_id: str) -> None:
    """Explicitly reset import retries for this public target, preserving other jobs."""
    job = queue.get(job_id)
    if job is None or job.kind != "retrieval" or job.state == "running":
        raise ValueError("Only an idle retrieval job may be retried")
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Wait for the current import before retrying") from None
        if job.state != "pending":
            queue.refresh_retrieval(job.id)
        for row in _pending_rows():
            if (
                row["source_url"] == job.payload["url"]
                and row["notification"]["intended_recipient_id"] == job.recipient_id
            ):
                queue.set_setting(f"notification_import_attempts:{row['id']}", 0)
        queue.set_setting(f"manual_imported:{job.id}", False)
        queue.set_setting(f"manual_import_attempts:{job.id}", 0)
