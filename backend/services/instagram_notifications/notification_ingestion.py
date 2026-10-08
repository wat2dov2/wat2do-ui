"""Bridge the production notification ledger to the shared Mac browser queue.

Retrieval never claims database media. Import claims only after verified post
fields are ready, journals its token before the network write, and releases
interrupted imports on the next scheduled run under a singleton import lock.
"""

from __future__ import annotations

import fcntl
import time
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from core.constants import WORKFLOW_RUN_ERROR
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.sanitize import parse_iso_datetime
from core.tables import INSTAGRAM_NOTIFICATION_MEDIA, INSTAGRAM_NOTIFICATIONS
from services import school_service
from services.instagram_notifications.browser_ingestion import canonical_target_url
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserSessionError,
    school_account_username,
)
from services.instagram_notifications.ledger import (
    claim_pending_browser_media,
    mark_media_succeeded,
    rollback_media_claim,
)
from services.scraper.pipeline import run_pipeline

_CONTROL = controlbox.instagram_browser
_JOURNAL = "notification_browser_import_claim"
_REVIEW_CURSOR = "notification_review_cursor"
_REVIEW_COUNTS = (
    "pending",
    "ready",
    "waiting",
    "failed",
    "held",
    "blocked",
    "excluded",
    "cancelled",
    "invalid",
    "selected",
)


def _pending_rows() -> list[dict]:
    def page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(INSTAGRAM_NOTIFICATION_MEDIA)
            .select(
                f"id,source_url,created_at,notification:{INSTAGRAM_NOTIFICATIONS}(intended_recipient_id)"
            )
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
    for row in _pending_rows():
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
        queue.retry_failed_retrieval(job_id)
        job = queue.get(job_id)
        if job and job.state == "pending":
            stats["queued"] += 1
    queue.set_setting("notification_source_status", {"checked_at": time.time(), **stats})
    return stats


def _review_cursor(queue: BrowserJobQueue) -> dict[str, Any]:
    cursor = queue.get_setting(_REVIEW_CURSOR, {"last_school": None, "next_newest": {}})
    if (
        not isinstance(cursor, dict)
        or set(cursor) != {"last_school", "next_newest"}
        or cursor["last_school"] is not None
        and not isinstance(cursor["last_school"], str)
        or not isinstance(cursor["next_newest"], dict)
        or any(
            not isinstance(school, str) or type(newest) is not bool
            for school, newest in cursor["next_newest"].items()
        )
    ):
        raise ValueError("Notification review cursor is invalid; inspect it before continuing")
    return cursor


def _review_held(queue: BrowserJobQueue, row: dict, school: str) -> bool:
    saved = queue.get_setting(f"notification_reviewed_target:{row['id']}")
    decision = saved.get("codex_review") if isinstance(saved, dict) else None
    return (
        isinstance(decision, dict)
        and decision.get("reviewer") == "Codex"
        and decision.get("decision") == "unresolved"
        and decision.get("school") == school
        and decision.get("source_url") == row["source_url"]
    )


def ready_review_targets(queue: BrowserJobQueue) -> dict[str, Any]:
    """Preview fresh, fair review targets without claiming or advancing progress.

    Commit a target's cursor_after only after its Codex decision and readback are
    durable. Each school alternates newest/oldest independently, including when
    the number of schools is an exact multiple of the configured batch size.
    """
    cursor = _review_cursor(queue)
    jobs = {
        (job.school, job.recipient_id, job.account_username, job.payload["url"]): job
        for job in queue.retrieval_results(succeeded_only=False)
        if job.payload.get("cutoff_days") == 1
    }
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    ready: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
    totals: Counter[str] = Counter()
    for row in _pending_rows():
        school = "unknown"
        try:
            school, recipient, username = _identity(row)
            url = canonical_target_url(row["source_url"])
            if queue.account_excluded(username):
                state = "excluded"
            else:
                job = jobs.get((school, recipient, username, url))
                if job is None or job.state in {"pending", "running"}:
                    state = "waiting"
                elif job.state == "cancelled":
                    state = "cancelled"
                elif job.state != "succeeded":
                    state = "failed"
                elif (
                    not job.result
                    or job.result.get("target_url") != url
                    or not isinstance(job.result.get("posts"), list)
                    or len(job.result["posts"]) != 1
                    or not isinstance(job.result["posts"][0], dict)
                    or canonical_target_url(job.result["posts"][0].get("url", "")) != url
                ):
                    state = "invalid"
                elif _review_held(queue, row, school):
                    state = "held"
                elif (
                    queue.get_setting(f"notification_import_attempts:{row['id']}", 0)
                    >= _CONTROL.ingestion_retry_limit
                ):
                    state = "blocked"
                else:
                    state = "ready"
                    ready[school].append(
                        {
                            "row": row,
                            "school": school,
                            "job_id": job.id,
                            "posts": job.result["posts"],
                        }
                    )
        except (KeyError, TypeError, ValueError, BrowserSessionError):
            state = "invalid"
        counts[school]["pending"] += 1
        counts[school][state] += 1
        totals["pending"] += 1
        totals[state] += 1

    for school, candidates in ready.items():
        ready[school] = deque(
            sorted(
                candidates,
                key=lambda target: (
                    parse_iso_datetime(target["posts"][0].get("timestamp"))
                    or parse_iso_datetime(target["row"].get("created_at"))
                    or datetime.min.replace(tzinfo=timezone.utc),
                    target["row"]["id"],
                ),
            )
        )
    schools = sorted(ready)
    last_school = cursor["last_school"]
    start = next(
        (
            index
            for index, school in enumerate(schools)
            if last_school is None or school > last_school
        ),
        0,
    )
    schools = schools[start:] + schools[:start]
    targets = []
    next_newest = dict(cursor["next_newest"])
    suggested = cursor
    while len(targets) < _CONTROL.ingestion_batch_size and any(ready.values()):
        for school in schools:
            if not ready[school]:
                continue
            newest = next_newest.get(school, True)
            target = ready[school].pop() if newest else ready[school].popleft()
            next_newest[school] = not newest
            suggested = {"last_school": school, "next_newest": dict(next_newest)}
            target["cursor_after"] = suggested
            targets.append(target)
            counts[school]["selected"] += 1
            if len(targets) >= _CONTROL.ingestion_batch_size:
                break
    totals["selected"] = len(targets)
    return {
        "checked_at": time.time(),
        "cursor": cursor,
        "suggested_next_cursor": suggested,
        "totals": {key: totals[key] for key in _REVIEW_COUNTS},
        "schools": {
            school: {key: value[key] for key in _REVIEW_COUNTS}
            for school, value in sorted(counts.items())
        },
        "targets": targets,
    }


def import_retrieved_media(queue: BrowserJobQueue) -> dict[str, int]:
    stats = {"imported": 0, "waiting": 0, "failed": 0, "recovered": 0, "blocked": 0, "invalid": 0}
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
            try:
                retrieval = _notification_retrieval(queue, row)
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
            if job.result.get("target_url") != canonical_target_url(row["source_url"]):
                stats["invalid"] += 1
                continue
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
            stats["invalid"] += 1
            continue
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
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Wait for the current import before retrying") from None
        job = queue.get(job_id)
        if job is None or job.kind != "retrieval" or job.state == "running":
            raise ValueError("Only an idle retrieval job may be retried")
        setting_keys = [f"manual_imported:{job.id}", f"manual_import_attempts:{job.id}"]
        for row in _pending_rows():
            try:
                matches = (
                    canonical_target_url(row["source_url"]) == job.payload["url"]
                    and row["notification"]["intended_recipient_id"] == job.recipient_id
                )
            except (KeyError, TypeError, ValueError, BrowserSessionError):
                continue
            if matches:
                setting_keys.append(f"notification_import_attempts:{row['id']}")
        queue.reset_retrieval_import(job.id, import_setting_keys=setting_keys)
