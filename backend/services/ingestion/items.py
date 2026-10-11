"""The Supabase ingestion queue: one row per Instagram post or directory page.

Instagram rows start at ``fetch`` and become ``ready`` once the logged-out
fetcher fills in the post. Directory rows arrive ``ready`` with finished
details. A processing agent turns each ready row into events or positions,
then the row is marked ``done`` or ``not_event`` and kept, so a URL is never
queued twice. Deleted posts end as ``gone``; rows that keep failing as ``failed``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INGESTION_ITEMS
from services import school_service

CONTROL = controlbox.ingestion
Stage = Literal["fetch", "ready"]
_POST_PATH = re.compile(r"^https://(?:www\.)?instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)/?$")


@dataclass(frozen=True)
class Item:
    source_url: str
    school: str
    source: Literal["instagram", "directory"]
    post: dict | None
    directory_source_id: int | None
    attempts: int


def claim(stage: Stage) -> Item | None:
    """Lease the oldest row waiting at ``stage``; two claimers never get the same row."""
    rows = (
        get_sb()
        .rpc(
            "claim_ingestion_item",
            {"p_stage": stage, "p_lease_seconds": CONTROL.claim_lease_seconds},
        )
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    row = rows[0]
    school = school_service.get_school_by_id(row["school_id"])
    return Item(
        source_url=row["source_url"],
        school=school.slug if school else "",
        source=row["source"],
        post=row["post"],
        directory_source_id=row["directory_source_id"],
        attempts=row["attempts"],
    )


def mark_fetched(item: Item, post: dict) -> None:
    _update(item, status="ready", post=post, attempts=0, claimed_until=None)


def mark(item: Item, status: Literal["done", "not_event", "gone"]) -> None:
    _update(item, status=status, claimed_until=None)


def release(item: Item, stage: Stage, *, delay_seconds: float | None = None) -> None:
    """Put a row back to wait; one that keeps failing is given up as ``failed``."""
    if item.attempts >= CONTROL.max_attempts:
        _update(item, status="failed", claimed_until=None)
        return
    delay = delay_seconds if delay_seconds is not None else CONTROL.retry_backoff_seconds
    _update(item, status=stage, claimed_until=_at(delay))


def post_key(url: str) -> str:
    """One queue key per post, whether it was shared as a post, reel or video."""
    match = _POST_PATH.fullmatch(url.strip())
    if match is None:
        raise ValueError("Not an Instagram post URL")
    return f"https://www.instagram.com/p/{match[1]}/"


def queue_instagram(urls: list[str], *, school: str) -> int:
    """Add Instagram posts to fetch; a post already in the queue keeps its row."""
    school_id = school_service.get_school_id(school)
    if school_id is None:
        raise ValueError("School is not registered")
    keys = dict.fromkeys(post_key(url) for url in urls)
    rows = [{"source_url": key, "school_id": school_id, "source": "instagram"} for key in keys]
    if not rows:
        return 0
    response = (
        get_sb()
        .table(INGESTION_ITEMS)
        .upsert(rows, on_conflict="source_url", ignore_duplicates=True)
        .execute()
    )
    return len(response.data or [])


def counts() -> dict[str, int]:
    statuses = ("fetch", "ready", "working", "done", "not_event", "gone", "failed")
    return {
        status: get_sb()
        .table(INGESTION_ITEMS)
        .select("source_url", count="exact", head=True)
        .eq("status", status)
        .execute()
        .count
        or 0
        for status in statuses
    }


def _at(seconds: float) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


def _update(item: Item, **values) -> None:
    get_sb().table(INGESTION_ITEMS).update(
        {**values, "updated_at": datetime.now(UTC).isoformat()}
    ).eq("source_url", item.source_url).execute()
