"""The accounts each school account should follow, and what an admin decided about them.

This table is the one place any feature asks for an account to be followed: it adds a
row with its ``source`` (a crawl, a club, an import, a school's club directory) and the
emulator follows what is approved. One row per school and handle is kept whatever its status, so an account
is never offered twice: an account an admin rejected stays rejected. Approving
creates the club when the school has none with that handle (or gives the account to the
club a directory row was found for), and queues the follow.

Rejecting an account the school may still follow (the row is followed, a follow was
tapped, or the school's own Following list showed it) queues an unfollow instead,
whoever rejects it: a database trigger
(``backend/database/migrations/20261126213700_follow_candidate_unfollow_one_path.sql``)
turns the rejection into ``unfollow``, and deleting a club rejects its account's row the
same way.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from core.constants import (
    FOLLOW_CANDIDATE_APPROVED,
    FOLLOW_CANDIDATE_FOLLOWED,
    FOLLOW_CANDIDATE_PENDING,
    FOLLOW_CANDIDATE_REJECTED,
    FOLLOW_CANDIDATE_UNFOLLOW,
    FOLLOW_SOURCE_CLUB,
    FOLLOW_SOURCE_CRAWL,
)
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import CLUBS, INSTAGRAM_FOLLOW_CANDIDATES

CONTROL = controlbox.instagram_follow
from schemas.club import CLUB_STATUS_APPROVED, ClubCreate, ClubUpdate
from services import club_service, school_service
from services.instagram_accounts import school_account_username
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


def record_following(school: str, followed: list[str], public: list[str]) -> None:
    """Take in what the school account's own Following list showed (``followed``, its
    ``public`` accounts among them), so every account it follows has a row.

    The list proves only what it shows, so nothing is concluded about an account it
    does not. Each row it shows is marked seen there; one rejected waits to be
    unfollowed again, since the account is still followed; a public account with no
    row goes to the scorer, and rejecting it then unfollows it. A partner of the
    school (``controlbox/partners.json``) is followed on purpose and left alone.
    """
    school_id = school_service.get_school_id(school)
    if school_id is None:
        return
    partners = {
        partner.instagram_handle
        for partner in controlbox.partners.partners
        if school in partner.schools
    }
    followed = sorted({normalize_handle(handle) for handle in followed} - partners - {None})
    known = known_handles(school_id)
    for handle in public:
        if normalize_handle(handle) not in known | partners:
            add_candidate(
                school_id,
                handle,
                source=FOLLOW_SOURCE_CRAWL,
                found_via=[school_account_username(school)],
            )
    now = datetime.now(timezone.utc).isoformat()
    for start in range(0, len(followed), _INSERT_CHUNK):
        chunk = followed[start : start + _INSERT_CHUNK]
        get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update({"seen_following_at": now}).eq(
            "school_id", school_id
        ).in_("handle", chunk).execute()
        get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(
            {"status": FOLLOW_CANDIDATE_UNFOLLOW, "follow_error": None, "updated_at": now}
        ).eq("school_id", school_id).in_("handle", chunk).eq(
            "status", FOLLOW_CANDIDATE_REJECTED
        ).execute()


def sync_club_targets() -> int:
    """Queue every listed club's Instagram account for its school's account to follow.

    Each goes in pending, linked to its club, so the scorer checks it belongs to the
    school like any other find. A club whose handle already has a row, in any status,
    is left alone. Returns how many rows were added.
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
                "status": FOLLOW_CANDIDATE_PENDING,
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


def decide(decisions: list[tuple[UUID, str]], *, decided_by: str | None) -> dict[str, int]:
    """Apply approvals and rejections to accounts still pending.

    The scorer decides here; an admin's decisions go through the API
    (``rust/src/api/routes/instagram_publishing/follow_candidates.rs``), which
    applies them the same way.

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


def auto_decide(candidate_id: str, status: str) -> None:
    """Apply the scorer's own decision to a pending account (no admin involved)."""
    decide([(candidate_id, status)], decided_by=None)


def requeue_for_recheck(limit: int) -> int:
    """Send rejected accounts that posted within the last year back to scoring.

    Only automated rejections that were scored over ``recheck_days`` ago, so a quiet
    club that starts posting again is picked up; an admin's rejection stays.
    """
    now = datetime.now(timezone.utc)
    rows = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select("id")
        .eq("status", FOLLOW_CANDIDATE_REJECTED)
        .is_("decided_by", "null")
        .eq("read_status", "ok")
        .gte("last_posted_at", (now - timedelta(days=365)).isoformat())
        .lt("scored_at", (now - timedelta(days=CONTROL.recheck_days)).isoformat())
        .order("scored_at")
        .limit(limit)
        .execute()
    ).data or []
    ids = [row["id"] for row in rows]
    if ids:
        get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(
            {
                "status": FOLLOW_CANDIDATE_PENDING,
                "scored_at": None,
                "decided_at": None,
                "updated_at": now.isoformat(),
            }
        ).in_("id", ids).eq("status", FOLLOW_CANDIDATE_REJECTED).execute()
    return len(ids)


def reject_gone(candidate_id: str) -> None:
    """The approved account's profile is gone or hidden: stop trying to follow it."""
    now = datetime.now(timezone.utc).isoformat()
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(
        {
            "status": FOLLOW_CANDIDATE_REJECTED,
            "follow_error": "Profile is gone or hidden",
            "reason": "Profile is gone or hidden",
            "updated_at": now,
        }
    ).eq("id", candidate_id).eq("status", FOLLOW_CANDIDATE_APPROVED).execute()


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
    """The club the row was found for (given the account when it has none), else the
    school's one club with the handle, else a new club."""
    if row.get("club_id") is not None:
        linked = club_service.get_club(int(row["club_id"]))
        if linked is not None and linked.school == row["school"]:
            if not (linked.ig or "").strip():
                club_service.update_club(linked.id, ClubUpdate(ig=row["handle"]))
            return linked.id
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
    """Pending accounts not scored yet, an equal share of each school's oldest, so one
    school's long backlog never keeps another's new finds waiting."""
    schools = list(EMULATOR.android_user_by_school)
    share = max(1, -(-limit // len(schools))) if schools else limit
    rows: list[dict[str, Any]] = []
    for school in schools:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            continue
        response = (
            get_sb()
            .table(INSTAGRAM_FOLLOW_CANDIDATES)
            .select(_SELECT)
            .eq("status", FOLLOW_CANDIDATE_PENDING)
            .eq("school_id", school_id)
            .is_("scored_at", "null")
            .order("created_at")
            .limit(share)
            .execute()
        )
        rows.extend(school_service.with_school_slug(row) for row in response.data or [])
    return rows[:limit]


def save_profile(candidate_id: str, profile: dict[str, Any], score: dict[str, Any] | None) -> None:
    """Store what the logged-out read saw (its newest posts too) and, when the scorer
    answered, its verdict."""
    posts = profile.get("posts") or []
    now = datetime.now(timezone.utc).isoformat()
    update: dict[str, Any] = {
        "read_status": profile["read"],
        "followers_count": profile.get("followers_count"),
        "posts_count": profile.get("posts_count"),
        "is_private": profile.get("is_private"),
        "last_posted_at": posts[0]["posted_at"] if posts else None,
        "recent_posts": [_stored_post(post) for post in posts],
        "updated_at": now,
    }
    if profile.get("name"):
        update["name"] = profile["name"]
    if score is not None:
        update.update(
            score=score["score"], verdict=score["verdict"], reason=score["reason"], scored_at=now
        )
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", candidate_id).execute()


def _stored_post(post: dict[str, Any]) -> dict[str, Any]:
    """A post as the admin's Automated follows tab shows it, its caption cut short."""
    return {
        "url": post["url"],
        "posted_at": post["posted_at"],
        "caption": (post.get("caption") or "")[: CONTROL.recent_post_caption_characters],
        "image": post.get("image"),
    }


def approved(school_id: int, limit: int) -> list[dict[str, Any]]:
    """Approved accounts waiting to be followed, in the order they were approved."""
    return _waiting(school_id, FOLLOW_CANDIDATE_APPROVED, limit)


def to_unfollow(school_id: int, limit: int) -> list[dict[str, Any]]:
    """Accounts waiting to be unfollowed, failed ones last, least recently tried first."""
    return _waiting(school_id, FOLLOW_CANDIDATE_UNFOLLOW, limit)


def _waiting(school_id: int, status: str, limit: int) -> list[dict[str, Any]]:
    """The school's accounts waiting in ``status`` for the emulator.

    Accounts whose last try failed go after the rest, least recently tried first, so one
    that keeps failing never holds up the others; one tried within
    ``follow_retry_hours`` is not offered again yet, so it never keeps the worker busy.
    """
    retry_before = datetime.now(timezone.utc) - timedelta(hours=CONTROL.follow_retry_hours)
    response = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select("id,handle,follow_error")
        .eq("school_id", school_id)
        .eq("status", status)
        .or_(f'follow_error.is.null,updated_at.lt."{retry_before.isoformat()}"')
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
    update = {"status": FOLLOW_CANDIDATE_FOLLOWED, "follow_error": None, "updated_at": now}
    if tapped:
        update["followed_at"] = now
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", candidate_id).execute()


def mark_follow_failed(candidate_id: str, error: str, *, tapped: bool = False) -> None:
    """Keep the account approved, so the next daily run tries again.

    ``tapped`` when this run followed it before failing: ``followed_at`` counts it
    toward the day's allowance.
    """
    now = datetime.now(timezone.utc).isoformat()
    update = {"follow_error": error, "updated_at": now}
    if tapped:
        update["followed_at"] = now
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", candidate_id).execute()


def mark_unfollowed(candidate_id: str, *, tapped: bool) -> None:
    """Record the account as rejected and unfollowed; ``unfollowed_at`` only when this run
    unfollowed it, so it counts toward the day's allowance."""
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": FOLLOW_CANDIDATE_REJECTED, "follow_error": None, "updated_at": now}
    if tapped:
        update["unfollowed_at"] = now
    get_sb().table(INSTAGRAM_FOLLOW_CANDIDATES).update(update).eq("id", candidate_id).execute()
