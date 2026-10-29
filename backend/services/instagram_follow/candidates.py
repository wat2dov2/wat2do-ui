"""The accounts each school account should follow, and what an admin decided about them.

This table is the one place any feature asks for an account to be followed: it adds a
row with its ``source`` (a crawl, a club, an import) and the emulator follows what is
approved. One row per school and handle is kept whatever its status, so an account
is never offered twice: an account an admin rejected stays rejected. Approving
creates the club when the school has none with that handle, and queues the follow.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from core.constants import (
    FOLLOW_CANDIDATE_APPROVED,
    FOLLOW_CANDIDATE_FOLLOWED,
    FOLLOW_CANDIDATE_PENDING,
    FOLLOW_CANDIDATE_REJECTED,
    FOLLOW_SOURCE_CLUB,
)
from core.database import get_sb
from core.errors import FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND
from core.exceptions import NotFoundError
from core.pagination import fetch_all_pages
from core.tables import CLUBS, INSTAGRAM_FOLLOW_CANDIDATES
from schemas.club import CLUB_STATUS_APPROVED, ClubCreate
from services import club_service, school_service
from services.instagram_emulator.device import CONTROL as EMULATOR

_SELECT = f"*,{school_service.SCHOOL_SLUG_EMBED}"
_HANDLE = re.compile(r"^[a-z0-9._]{1,30}$")
_INSERT_CHUNK = 500


def normalize_handle(value: str | None) -> str | None:
    """The bare Instagram username, or None when the value is not one."""
    handle = (value or "").strip().lstrip("@").casefold()
    return handle if _HANDLE.fullmatch(handle) else None


def known_handles(school_id: int) -> set[str]:
    """Every handle the school already has a row for, whatever its status."""

    def page(offset: int, size: int) -> list[dict]:
        return (
            get_sb()
            .table(INSTAGRAM_FOLLOW_CANDIDATES)
            .select("handle")
            .eq("school_id", school_id)
            .order("handle")
            .range(offset, offset + size - 1)
            .execute()
        ).data or []

    return {row["handle"] for row in fetch_all_pages(page)}


def add_candidate(
    school_id: int,
    handle: str,
    *,
    source: str,
    name: str | None = None,
    found_via: list[str] | None = None,
    status: str = FOLLOW_CANDIDATE_PENDING,
) -> None:
    """Ask for an account to be followed; one already on record is left as it is."""
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).upsert(
        {
            "school_id": school_id,
            "handle": normalize_handle(handle),
            "source": source,
            "name": name or None,
            "found_via": found_via or [],
            "status": status,
        },
        on_conflict="school_id,handle",
        ignore_duplicates=True,
    ).execute()


def sync_club_targets() -> int:
    """Queue every listed club's Instagram account for following by its school's account.

    Our own clubs need no review, so they go in approved. A club whose handle already
    has a row, in any status, is left alone. Returns how many rows were added.
    """
    school_ids = {
        school_id
        for school_id in (
            school_service.get_school_id(slug) for slug in EMULATOR.android_user_by_school
        )
        if school_id is not None
    }

    def page(offset: int, size: int) -> list[dict]:
        return (
            get_sb()
            .table(CLUBS)
            .select("id,club_name,ig,school_id")
            .eq("status", CLUB_STATUS_APPROVED)
            .not_.is_("ig", "null")
            .order("id")
            .range(offset, offset + size - 1)
            .execute()
        ).data or []

    rows: dict[tuple[int, str], dict] = {}
    for club in fetch_all_pages(page):
        handle = normalize_handle(club["ig"])
        if handle is None or club["school_id"] not in school_ids:
            continue
        rows.setdefault(
            (club["school_id"], handle),
            {
                "school_id": club["school_id"],
                "handle": handle,
                "name": club["club_name"],
                "source": FOLLOW_SOURCE_CLUB,
                "status": FOLLOW_CANDIDATE_APPROVED,
                "club_id": club["id"],
            },
        )
    added = 0
    values = list(rows.values())
    for start in range(0, len(values), _INSERT_CHUNK):
        response = (
            get_sb()
            .table(INSTAGRAM_FOLLOW_CANDIDATES)
            .upsert(
                values[start : start + _INSERT_CHUNK],
                on_conflict="school_id,handle",
                ignore_duplicates=True,
            )
            .execute()
        )
        added += len(response.data or [])
    return added


def list_candidates(
    *, school: str | None, status: str, offset: int, limit: int
) -> tuple[list[dict[str, Any]], int]:
    query = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select(_SELECT, count="exact")
        .eq("status", status)
    )
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            raise NotFoundError(FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND)
        query = query.eq("school_id", school_id)
    response = (
        query.order("score", desc=True, nullsfirst=False)
        .order("handle")
        .range(offset, offset + limit - 1)
        .execute()
    )
    rows = [school_service.with_school_slug(row) for row in response.data or []]
    return rows, response.count or len(rows)


def decide(decisions: list[tuple[UUID, str]], *, decided_by: str) -> dict[str, int]:
    """Apply an admin's batch of approvals and rejections to accounts still pending.

    Approving creates the school's club for the handle unless one exists, so the
    account is listed and its events have a home before it is even followed.
    """
    rows = _pending_rows([candidate_id for candidate_id, _ in decisions])
    now = datetime.now(timezone.utc).isoformat()
    outcomes = {FOLLOW_CANDIDATE_APPROVED: 0, FOLLOW_CANDIDATE_REJECTED: 0}
    for candidate_id, status in decisions:
        row = rows.get(str(candidate_id))
        if row is None:
            continue
        update: dict[str, Any] = {
            "status": status,
            "decided_by": decided_by,
            "decided_at": now,
            "updated_at": now,
        }
        if status == FOLLOW_CANDIDATE_APPROVED:
            update["club_id"] = _club_for(row)
        get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", row["id"]).execute()
        outcomes[status] += 1
    return outcomes


def _pending_rows(ids: list[UUID]) -> dict[str, dict]:
    if not ids:
        return {}
    response = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select(_SELECT)
        .in_("id", [str(candidate_id) for candidate_id in ids])
        .eq("status", FOLLOW_CANDIDATE_PENDING)
        .execute()
    )
    return {row["id"]: school_service.with_school_slug(row) for row in response.data or []}


def _club_for(row: dict) -> int:
    existing = club_service.lookup_club_by_school_and_ig(row["school"], row["handle"])
    if existing is not None:
        return int(existing["id"])
    club = club_service.create_club(
        ClubCreate(
            club_name=row.get("name") or row["handle"], ig=row["handle"], school=row["school"]
        ),
        created_by=None,
        auto_approve=True,
    )
    return club.id


def unscored(limit: int) -> list[dict[str, Any]]:
    """Pending accounts not scored yet, oldest first."""
    response = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select(_SELECT)
        .eq("status", FOLLOW_CANDIDATE_PENDING)
        .is_("scored_at", "null")
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return [school_service.with_school_slug(row) for row in response.data or []]


def save_profile(candidate_id: str, profile: dict[str, Any], score: dict[str, Any] | None) -> None:
    """Store what the logged-out read saw and, when the scorer answered, its verdict."""
    posts = profile.get("posts") or []
    now = datetime.now(timezone.utc).isoformat()
    update: dict[str, Any] = {
        "read_status": profile["read"],
        "followers_count": profile.get("followers_count"),
        "posts_count": profile.get("posts_count"),
        "is_private": profile.get("is_private"),
        "last_posted_at": posts[0]["posted_at"] if posts else None,
        "updated_at": now,
    }
    if profile.get("name"):
        update["name"] = profile["name"]
    if score is not None:
        update.update(
            score=score["score"], verdict=score["verdict"], reason=score["reason"], scored_at=now
        )
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", candidate_id).execute()


def approved(school_id: int, limit: int) -> list[dict[str, Any]]:
    """Approved accounts waiting to be followed, in the order they were approved.

    Accounts whose follow failed go after the rest, least recently tried first, so one
    that keeps failing never holds up the others.
    """
    response = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select("id,handle")
        .eq("school_id", school_id)
        .eq("status", FOLLOW_CANDIDATE_APPROVED)
        .order("follow_error", nullsfirst=True)
        .order("updated_at")
        .order("decided_at")
        .limit(limit)
        .execute()
    )
    return response.data or []


def mark_followed(candidate_id: str, *, tapped: bool) -> None:
    """Record the account as followed; ``followed_at`` only when this run followed it,
    so accounts the school already followed never use up a day's allowance."""
    now = datetime.now(timezone.utc).isoformat()
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(
        {
            "status": FOLLOW_CANDIDATE_FOLLOWED,
            "followed_at": now if tapped else None,
            "follow_error": None,
            "updated_at": now,
        }
    ).eq("id", candidate_id).execute()


def mark_follow_failed(candidate_id: str, error: str) -> None:
    """Keep the account approved, so the next daily run tries again."""
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(
        {"follow_error": error, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", candidate_id).execute()
