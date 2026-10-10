"""Bridge the production notification ledger to the Mac's local ingestion queue.

The browser worker retrieves each pending notification target in Brave. Each
retrieved post is captured into the source-agnostic ingestion queue, whose
processor extracts and writes events. The ledger row is claimed only after the
capture is durable, and its token is journaled before the claim request so an
interrupted run releases the claim on the next pass under a singleton lock.
"""

from __future__ import annotations

import fcntl
import time
from uuid import uuid4

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import INSTAGRAM_NOTIFICATION_MEDIA, INSTAGRAM_NOTIFICATIONS
from services import school_service
from services.ingestion.queue import IngestionQueue, QueueItem
from services.instagram_notifications.browser_ingestion import canonical_target_url
from services.instagram_notifications.browser_queue import BrowserJob, BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserSessionError,
    school_account_username,
)
from services.instagram_notifications.ledger import (
    acknowledge_browser_delivery,
    claim_pending_browser_media,
    mark_media_succeeded,
    rollback_media_claim,
)

_JOURNAL = "notification_ledger_claim"


def _pending_rows(delivery_generation: str | None = None) -> list[dict]:
    """Snapshot pending rows before acknowledgement can change page offsets."""

    def page(offset: int, page_size: int) -> list[dict]:
        query = (
            get_sb()
            .table(INSTAGRAM_NOTIFICATION_MEDIA)
            .select(
                f"id,source_url,created_at,notification:{INSTAGRAM_NOTIFICATIONS}(intended_recipient_id)"
            )
            .eq("status", "pending")
            .order("created_at")
            .order("id")
            .range(offset, offset + page_size - 1)
        )
        if delivery_generation is not None:
            query = query.or_(
                "browser_delivery_generation.is.null,"
                f"browser_delivery_generation.neq.{delivery_generation}"
            )
        return query.execute().data or []

    return fetch_all_pages(page)


def _identity(row: dict) -> tuple[str, str, str]:
    recipient = row["notification"]["intended_recipient_id"]
    school = school_service.get_school_by_recipient_id(recipient)
    if school is None:
        raise ValueError("Notification recipient has no configured school")
    return school.slug, recipient, school_account_username(school.slug)


def _notification_retrieval(queue: BrowserJobQueue, row: dict) -> tuple[str, str] | None:
    school, recipient, username = _identity(row)
    if queue.account_excluded(username):
        return None
    job_id = queue.enqueue_retrieval(
        school=school,
        recipient_id=recipient,
        account_username=username,
        url=row["source_url"],
    )
    return school, job_id


def sync_notification_media(queue: BrowserJobQueue) -> dict[str, int]:
    stats = {"pending_media": 0, "queued": 0, "invalid": 0}
    delivery_generation = queue.delivery_generation
    for row in _pending_rows(delivery_generation):
        try:
            retrieval = _notification_retrieval(queue, row)
        except (KeyError, TypeError, ValueError, BrowserSessionError):
            # Leave invalid ledger rows pending for repair without starving other schools.
            # Storage and network failures still propagate to the source health report.
            stats["invalid"] += 1
            continue
        if retrieval is None:
            continue
        _, job_id = retrieval
        stats["pending_media"] += 1
        job = queue.get(job_id)
        if job is None:
            raise RuntimeError("Notification retrieval disappeared before delivery acknowledgement")
        if job.state == "pending":
            stats["queued"] += 1
        queue.set_setting(f"notification_delivery:{row['id']}", job_id)
        acknowledge_browser_delivery(
            table=INSTAGRAM_NOTIFICATION_MEDIA,
            row_id=row["id"],
            delivery_generation=delivery_generation,
        )
    queue.set_setting("notification_source_status", {"checked_at": time.time(), **stats})
    return stats


def _exact_post(job: BrowserJob, target_url: str) -> dict | None:
    """Return the one retrieved post that is exactly the notification target."""
    result = job.result or {}
    posts = result.get("posts")
    if (
        result.get("target_url") != target_url
        or not isinstance(posts, list)
        or len(posts) != 1
        or not isinstance(posts[0], dict)
        or canonical_target_url(posts[0].get("url", "")) != target_url
    ):
        return None
    return posts[0]


def enqueue_retrieved_media(queue: BrowserJobQueue) -> dict[str, int]:
    """Capture retrieved notification and manual targets, then settle their ledger rows."""
    stats = {"enqueued": 0, "waiting": 0, "failed": 0, "recovered": 0, "invalid": 0}
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**stats, "busy": 1}
        prior = queue.get_setting(_JOURNAL)
        if prior:
            stats["recovered"] += int(rollback_media_claim(**prior))
            queue.set_setting(_JOURNAL, None)
        ingestion = IngestionQueue()
        for row in _pending_rows():
            try:
                retrieval = _notification_retrieval(queue, row)
                target_url = canonical_target_url(row["source_url"])
            except (KeyError, TypeError, ValueError, BrowserSessionError):
                stats["invalid"] += 1
                continue
            if retrieval is None:
                continue
            school, job_id = retrieval
            job = queue.get(job_id)
            if not job or job.state != "succeeded" or not job.result:
                stats["waiting"] += 1
                continue
            post = _exact_post(job, target_url)
            if post is None:
                stats["invalid"] += 1
                continue
            ingestion.enqueue(QueueItem(school=school, post=post))
            claim = {"media_row_id": row["id"], "claim_token": str(uuid4())}
            queue.set_setting(_JOURNAL, claim)
            # If the request raises, keep the journal for the next run to recover.
            if not claim_pending_browser_media(**claim):
                queue.set_setting(_JOURNAL, None)
                continue
            if mark_media_succeeded(**claim):
                stats["enqueued"] += 1
            else:
                rollback_media_claim(**claim)
                stats["failed"] += 1
            queue.set_setting(_JOURNAL, None)
        _enqueue_manual_targets(queue, ingestion, stats)
    queue.set_setting("notification_enqueue_status", {"checked_at": time.time(), **stats})
    return stats


def _enqueue_manual_targets(
    queue: BrowserJobQueue, ingestion: IngestionQueue, stats: dict[str, int]
) -> None:
    for job in queue.retrieval_results():
        key = f"manual_enqueued:{job.id}"
        if (
            queue.account_excluded(job.account_username)
            or not queue.get_setting(f"manual_retrieval:{job.id}")
            or queue.get_setting(key)
        ):
            continue
        posts = (job.result or {}).get("posts")
        if (job.result or {}).get("target_url") != job.payload["url"] or not isinstance(
            posts, list
        ):
            stats["invalid"] += 1
            continue
        for post in posts:
            ingestion.enqueue(QueueItem(school=job.school, post=post))
        queue.set_setting(key, True)
        stats["enqueued"] += len(posts)


def retry_retrieved_media(queue: BrowserJobQueue, job_id: str) -> None:
    """Retrieve one public target again so its fresh result is captured again."""
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Wait for the current capture before retrying") from None
        queue.retry_retrieval(job_id)
