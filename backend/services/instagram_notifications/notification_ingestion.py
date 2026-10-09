"""Bridge the production notification ledger to the shared Mac browser queue.

Retrieval never claims database media. Import claims only after verified post
fields are ready, journals its token before the network write, and releases
interrupted imports on the next scheduled run under a singleton import lock.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import re
import subprocess
import time
from collections import Counter, defaultdict, deque
from collections.abc import Sequence
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from core.constants import WORKFLOW_RUN_ERROR
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.sanitize import parse_iso_datetime
from core.tables import INSTAGRAM_NOTIFICATION_MEDIA, INSTAGRAM_NOTIFICATIONS, SCHOOLS
from services import school_service
from services.instagram_notifications.browser_ingestion import canonical_target_url
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserSessionError,
    school_account_username,
)
from services.instagram_notifications.ledger import (
    acknowledge_browser_delivery,
    claim_pending_browser_media,
    mark_media_succeeded,
    retry_failed_media,
    rollback_media_claim,
    validate_failed_media_retry,
)
from services.scraper.pipeline import run_pipeline

_CONTROL = controlbox.instagram_browser
_JOURNAL = "notification_browser_import_claim"
_REVIEW_CURSOR = "notification_review_cursor"
_FAILED_OWNER_REPOSITORY = controlbox.emulator_farm.github_repository
_FAILED_RESET_FIELDS = {
    "status",
    "claim_token",
    "failure_category",
    "github_run_id",
    "succeeded_at",
    "browser_delivery_generation",
    "updated_at",
}
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


def ready_review_targets(
    queue: BrowserJobQueue, *, held_media_ids: Sequence[str] | None = None
) -> dict[str, Any]:
    """Preview fresh, fair review targets without claiming or advancing progress.

    Commit a target's cursor_after only after its Codex decision and readback are
    durable. Each school alternates newest/oldest independently, including when
    the number of schools is an exact multiple of the configured batch size.

    Explicit held IDs stage fresh review evidence without clearing an unresolved
    decision or advancing the ordinary backlog cursor.
    """
    requested = tuple(held_media_ids) if held_media_ids is not None else None
    if requested is not None:
        if not requested or len(requested) > _CONTROL.ingestion_batch_size:
            raise ValueError("Held review requests must fit the configured batch size")
        try:
            valid_ids = all(isinstance(rid, str) and str(UUID(rid)) == rid for rid in requested)
        except ValueError:
            valid_ids = False
        if not valid_ids:
            raise ValueError("Held review requests require canonical media row IDs")
        if len(set(requested)) != len(requested):
            raise ValueError("Held review requests must not repeat media row IDs")
    cursor = _review_cursor(queue)
    jobs = {
        (job.school, job.recipient_id, job.account_username, job.payload["url"]): job
        for job in queue.retrieval_results(succeeded_only=False)
        if job.payload.get("cutoff_days") == 1
    }
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    ready: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
    totals: Counter[str] = Counter()
    held_targets: dict[str, dict[str, Any]] = {}
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
                    if requested is not None and row["id"] in requested:
                        saved = queue.get_setting(f"notification_reviewed_target:{row['id']}")
                        if not isinstance(saved, dict):
                            raise ValueError("Held review evidence no longer matches its target")
                        decision = saved.get("codex_review", {})
                        if (
                            saved.get("school") != school
                            or saved.get("job_id") != job.id
                            or not isinstance(saved.get("row"), dict)
                            or saved.get("row", {}).get("id") != row["id"]
                            or saved["row"].get("source_url") != row["source_url"]
                            or not isinstance(saved["row"].get("notification"), dict)
                            or saved["row"].get("notification", {}).get("intended_recipient_id")
                            != recipient
                            or not isinstance(decision, dict)
                            or decision.get("reviewer") != "Codex"
                            or decision.get("decision") != "unresolved"
                            or decision.get("school") != school
                            or decision.get("source_url") != row["source_url"]
                            or not isinstance(saved.get("posts"), list)
                            or len(saved["posts"]) != 1
                            or not isinstance(saved["posts"][0], dict)
                            or canonical_target_url(saved["posts"][0].get("url", "")) != url
                            or queue.get_setting(f"notification_import_attempts:{row['id']}", 0)
                            >= _CONTROL.ingestion_retry_limit
                        ):
                            raise ValueError("Held review evidence no longer matches its target")
                        held_targets[row["id"]] = {
                            "row": row,
                            "school": school,
                            "job_id": job.id,
                            "posts": deepcopy(job.result["posts"]),
                            "codex_review": deepcopy(decision),
                            "prior_held_review_sha256": hashlib.sha256(
                                json.dumps(
                                    saved, ensure_ascii=False, separators=(",", ":")
                                ).encode()
                            ).hexdigest(),
                        }
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

    if requested is not None and set(held_targets) != set(requested):
        raise ValueError("Every requested media row must have a current, complete held review")
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
    if requested is not None:
        targets = [held_targets[rid] for rid in requested]
        for target in targets:
            counts[target["school"]]["selected"] += 1
    while (
        requested is None and len(targets) < _CONTROL.ingestion_batch_size and any(ready.values())
    ):
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


def _failed_media_owner(run_id: Any) -> dict[str, Any]:
    """Verify the historical claimant, never rerun its old workflow."""
    if not isinstance(run_id, str) or not re.fullmatch(r"[1-9][0-9]{0,49}", run_id):
        raise ValueError("Failed media has no valid owning workflow")
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{_FAILED_OWNER_REPOSITORY}/actions/runs/{run_id}"],
            capture_output=True,
            text=True,
            check=True,
            timeout=controlbox.scraping.workflow_status_timeout_seconds,
        )
        run = json.loads(result.stdout)
        if (
            type(run.get("id")) is not int
            or str(run["id"]) != run_id
            or run.get("repository", {}).get("full_name") != _FAILED_OWNER_REPOSITORY
            or run.get("path") != ".github/workflows/scrape-pending-media.yml"
            or run.get("status") != "completed"
            or run.get("conclusion")
            not in {
                "success",
                "failure",
                "cancelled",
                "timed_out",
                "action_required",
                "neutral",
                "skipped",
                "stale",
                "startup_failure",
            }
            or type(run.get("run_attempt")) is not int
            or run["run_attempt"] < 1
            or not isinstance(run.get("head_sha"), str)
            or re.fullmatch(r"[0-9a-f]{40}", run["head_sha"]) is None
        ):
            raise ValueError
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
        raise ValueError("Failed media owning workflow is not verified terminal") from None
    return {
        "repository": _FAILED_OWNER_REPOSITORY,
        "id": run_id,
        "path": run["path"],
        "run_attempt": run["run_attempt"],
        "head_sha": run["head_sha"],
        "conclusion": run["conclusion"],
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _failed_media_rows(media_ids: Sequence[str]) -> dict[str, dict]:
    try:
        rows = (
            get_sb()
            .table(INSTAGRAM_NOTIFICATION_MEDIA)
            .select("*")
            .in_("id", list(media_ids))
            .execute()
            .data
            or []
        )
        result = {row["id"]: row for row in rows}
        if len(result) != len(rows) or set(result) != set(media_ids):
            raise ValueError
        return result
    except Exception:
        raise RuntimeError("Failed media recovery could not read its exact ledger rows") from None


def _failed_media_routing(queue: BrowserJobQueue, row: dict) -> dict[str, Any]:
    try:
        notification = (
            get_sb()
            .table(INSTAGRAM_NOTIFICATIONS)
            .select("id,school_id,intended_recipient_id")
            .eq("id", row["notification_id"])
            .single()
            .execute()
            .data
        )
        recipient = notification["intended_recipient_id"]
        # The ordinary school helpers cache routing; a failed-row reset must read it fresh.
        school = (
            get_sb()
            .table(SCHOOLS)
            .select("id,slug,recipient_id")
            .eq("id", notification["school_id"])
            .single()
            .execute()
            .data
        )
        if (
            notification["id"] != row["notification_id"]
            or not isinstance(school, dict)
            or type(notification["school_id"]) is not int
            or type(school["id"]) is not int
            or school["id"] <= 0
            or school["id"] != notification["school_id"]
            or not isinstance(school["slug"], str)
            or school["recipient_id"] != recipient
        ):
            raise ValueError
        username = school_account_username(school["slug"])
        url = canonical_target_url(row["source_url"])
    except Exception:
        raise ValueError("Failed media current school and recipient routing is invalid") from None
    if queue.account_excluded(username):
        raise ValueError("Failed media account is excluded")
    if queue.get_setting(f"notification_reviewed_target:{row['id']}"):
        raise ValueError("Failed media has existing review evidence requiring inspection")
    attempts = queue.get_setting(f"notification_import_attempts:{row['id']}", 0)
    if type(attempts) is not int or not 0 <= attempts < _CONTROL.ingestion_retry_limit:
        raise ValueError("Failed media import budget requires inspection")
    with closing(queue._connect()) as db:
        jobs = db.execute(
            "SELECT id,state FROM jobs WHERE kind='retrieval' AND recipient_id=? "
            "AND account_username=? AND json_extract(payload,'$.url')=?",
            (recipient, username, url),
        ).fetchall()
    if any(job["state"] in {"failed", "cancelled", "unsupported"} for job in jobs):
        raise ValueError("Failed media existing retrieval requires inspection")
    return {
        "notification_id": notification["id"],
        "school_id": school["id"],
        "school": school["slug"],
        "intended_recipient_id": recipient,
        "account_username": username,
    }


def _recovered_pending_matches(
    queue: BrowserJobQueue, original: dict, current: dict, routing: dict
) -> bool:
    if (
        set(current) != set(original)
        or current.get("status") != "pending"
        or any(
            current.get(key) is not None
            for key in ("claim_token", "failure_category", "github_run_id", "succeeded_at")
        )
    ):
        return False
    if BrowserJobQueue._review_hash(
        {key: value for key, value in current.items() if key not in _FAILED_RESET_FIELDS}
    ) != BrowserJobQueue._review_hash(
        {key: value for key, value in original.items() if key not in _FAILED_RESET_FIELDS}
    ):
        return False
    try:
        before = datetime.fromisoformat(original["updated_at"].replace("Z", "+00:00"))
        after = datetime.fromisoformat(current["updated_at"].replace("Z", "+00:00"))
        if before.tzinfo is None or after.tzinfo is None or after <= before:
            return False
    except (AttributeError, KeyError, TypeError, ValueError):
        return False
    generation = current.get("browser_delivery_generation")
    if generation is None:
        return True
    if generation != queue.delivery_generation:
        return False
    job = queue.get(queue.get_setting(f"notification_delivery:{original['id']}", ""))
    return bool(
        job
        and job.kind == "retrieval"
        and job.state in {"pending", "running", "succeeded"}
        and job.school == routing["school"]
        and job.recipient_id == routing["intended_recipient_id"]
        and job.account_username == routing["account_username"]
        and job.payload.get("url") == canonical_target_url(original["source_url"])
    )


def recover_failed_media(
    queue: BrowserJobQueue,
    media_ids: Sequence[str],
    *,
    apply: bool = False,
) -> dict[str, Any]:
    """Explicitly reopen only SHA-bound terminal rows into the existing review path."""
    requested = tuple(media_ids)
    try:
        valid = all(
            isinstance(rid, str) and str(UUID(rid)) == rid and UUID(rid).int > 0
            for rid in requested
        )
    except ValueError:
        valid = False
    if (
        not valid
        or not requested
        or len(set(requested)) != len(requested)
        or len(requested) > _CONTROL.ingestion_batch_size
    ):
        raise ValueError(
            "Failed media recovery requires unique canonical IDs within the batch limit"
        )
    path = queue.state_directory / "notification-failed-recovery.json"
    stats: dict[str, Any] = {
        "selected": len(requested),
        "eligible": 0,
        "reopened": 0,
        "reconciled": 0,
        "blocked": 0,
        "queued": 0,
        "apply": apply,
        "evidence_path": str(path),
        "rows": [],
    }
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**stats, "busy": 1}
        if queue.get_setting(_JOURNAL):
            return {**stats, "busy": 1}
        current = _failed_media_rows(requested)
        publication = None
        if path.exists():
            original_bytes = queue.review_artifact_bytes(path)
            publication = hashlib.sha256(original_bytes).hexdigest()
            journal = json.loads(original_bytes)
            if (
                not isinstance(journal, dict)
                or type(journal.get("version")) is not int
                or journal["version"] != 1
                or not isinstance(journal.get("rows"), dict)
            ):
                raise ValueError(
                    "Failed media recovery evidence changed; preserve it for inspection"
                )
        else:
            journal = {
                "version": 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "rows": {},
            }
        for rid in requested:
            if rid not in journal["rows"]:
                journal["rows"][rid] = {
                    "original_media": deepcopy(current[rid]),
                    "intent": None,
                    "delivery_generation": queue.delivery_generation,
                    "outcome": "preview",
                }
            entry = journal["rows"][rid]
            if (
                not isinstance(entry, dict)
                or not isinstance(entry.get("original_media"), dict)
                or entry["original_media"].get("id") != rid
                or "intent" not in entry
                or (
                    entry["intent"] is not None
                    and (
                        not isinstance(entry["intent"], dict)
                        or set(entry["intent"]) != {"started_at"}
                        or not isinstance(entry["intent"]["started_at"], str)
                        or parse_iso_datetime(entry["intent"]["started_at"]) is None
                    )
                )
            ):
                raise ValueError(
                    "Failed media recovery evidence is invalid; preserve it for inspection"
                )

        def publish() -> None:
            nonlocal publication
            text = json.dumps(journal, ensure_ascii=False)
            if not queue.write_review_artifact(path, text, expected_sha256=publication):
                raise RuntimeError("Failed media recovery evidence changed during publication")
            raw = text.encode("utf-8")
            if queue.review_artifact_bytes(path) != raw:
                raise RuntimeError("Failed media evidence publication could not be verified")
            publication = hashlib.sha256(raw).hexdigest()

        owners = {}
        for rid in requested:
            entry = journal["rows"][rid]
            try:
                original = entry["original_media"]
                if original.get("id") != rid or original.get("status") != "failed":
                    raise ValueError("Failed media original terminal identity is invalid")
                if entry.get("delivery_generation") != queue.delivery_generation:
                    raise ValueError("Failed media queue generation changed")
                routing = _failed_media_routing(queue, current[rid])
                validate_failed_media_retry(
                    original,
                    school_id=routing["school_id"],
                    intended_recipient_id=routing["intended_recipient_id"],
                )
                if "routing" in entry and BrowserJobQueue._review_hash(
                    entry["routing"]
                ) != BrowserJobQueue._review_hash(routing):
                    raise ValueError("Failed media original routing changed")
                entry["routing"] = routing
                run_id = original["github_run_id"]
                if run_id not in owners:
                    owners[run_id] = _failed_media_owner(run_id)
                proof = owners[run_id]
                prior = entry.get("owner_run")
                if prior is not None and (
                    not isinstance(prior, dict)
                    or any(
                        BrowserJobQueue._review_hash(prior.get(field))
                        != BrowserJobQueue._review_hash(proof[field])
                        for field in ("repository", "id", "path", "head_sha", "run_attempt")
                    )
                ):
                    raise ValueError("Failed media owning workflow generation changed")
                entry["owner_run"] = proof
                if entry.get("intent") is None:
                    if BrowserJobQueue._review_hash(original) != BrowserJobQueue._review_hash(
                        current[rid]
                    ):
                        raise ValueError("Failed media original ledger generation changed")
                elif not _recovered_pending_matches(queue, original, current[rid], routing):
                    raise ValueError("Failed media attempted outcome is uncertain or advanced")
            except (KeyError, TypeError, ValueError) as exc:
                entry["blocked_reason"] = (
                    str(exc) if isinstance(exc, ValueError) else "Failed media evidence is invalid"
                )
                stats["blocked"] += 1
            else:
                entry.pop("blocked_reason", None)
                stats["eligible"] += 1
        # This immutable original evidence must exist before any cloud reset.
        publish()
        jobs = set()
        if apply and not stats["blocked"]:
            for rid in requested:
                entry = journal["rows"][rid]
                original, routing = entry["original_media"], entry["routing"]
                fresh = _failed_media_rows([rid])[rid]
                if BrowserJobQueue._review_hash(
                    _failed_media_routing(queue, fresh)
                ) != BrowserJobQueue._review_hash(routing):
                    raise RuntimeError("Failed media routing changed before recovery admission")
                if entry.get("intent") is None and BrowserJobQueue._review_hash(
                    original
                ) != BrowserJobQueue._review_hash(fresh):
                    raise RuntimeError("Failed media ledger changed before recovery admission")
                if entry.get("intent") is None:
                    validate_failed_media_retry(
                        fresh,
                        school_id=routing["school_id"],
                        intended_recipient_id=routing["intended_recipient_id"],
                    )
                    proof = _failed_media_owner(original["github_run_id"])
                    if any(
                        BrowserJobQueue._review_hash(entry["owner_run"].get(field))
                        != BrowserJobQueue._review_hash(proof[field])
                        for field in ("repository", "id", "path", "head_sha", "run_attempt")
                    ):
                        raise RuntimeError(
                            "Failed media owning workflow changed before recovery admission"
                        )
                    entry["owner_run"] = proof
                    entry["intent"] = {"started_at": datetime.now(timezone.utc).isoformat()}
                    publish()
                    try:
                        reset = retry_failed_media(
                            fresh,
                            school_id=routing["school_id"],
                            intended_recipient_id=routing["intended_recipient_id"],
                        )
                    except Exception:
                        entry["outcome"] = "unconfirmed"
                    else:
                        entry["outcome"] = "reset" if reset else "unconfirmed"
                after = _failed_media_rows([rid])[rid]
                entry["readback"] = deepcopy(after)
                if not _recovered_pending_matches(queue, original, after, routing):
                    entry["outcome"] = "inspection_required"
                    stats["blocked"] += 1
                    publish()
                    break
                stats["reopened" if entry["outcome"] == "reset" else "reconciled"] += 1
                entry["outcome"] = "pending_verified"
                if BrowserJobQueue._review_hash(
                    _failed_media_routing(queue, after)
                ) != BrowserJobQueue._review_hash(routing):
                    raise RuntimeError("Failed media routing changed after recovery readback")
                job_id = queue.enqueue_retrieval(
                    school=routing["school"],
                    recipient_id=routing["intended_recipient_id"],
                    account_username=routing["account_username"],
                    url=after["source_url"],
                )
                job = queue.get(job_id)
                if (
                    not job
                    or job.kind != "retrieval"
                    or job.state not in {"pending", "running", "succeeded"}
                    or job.school != routing["school"]
                    or job.recipient_id != routing["intended_recipient_id"]
                    or job.account_username != routing["account_username"]
                    or job.payload.get("url") != canonical_target_url(after["source_url"])
                ):
                    raise RuntimeError("Failed media retrieval routing changed during admission")
                queue.set_setting(f"notification_delivery:{rid}", job_id)
                entry["job_id"] = job_id
                jobs.add(job_id)
                publish()
        stats["queued"] = len(jobs)
        sources = set()
        for rid in requested:
            entry = journal["rows"][rid]
            try:
                sources.add(
                    (
                        entry["routing"]["intended_recipient_id"],
                        canonical_target_url(entry["original_media"]["source_url"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                # Malformed blocked rows still retain their complete original evidence.
                continue
        stats["distinct_sources"] = len(sources)
        stats["rows"] = [
            {
                "media_row_id": entry["original_media"]["id"],
                "outcome": entry["outcome"],
                "blocked_reason": entry.get("blocked_reason"),
                "job_id": entry.get("job_id"),
            }
            for entry in (journal["rows"][rid] for rid in requested)
        ]
        return stats
