"""Clubs via the data API. Sync."""

import functools
import json
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

from uuid import UUID

from postgrest.exceptions import APIError

from core.auth import is_admin
from core.constants import (
    DEFAULT_LIST_LIMIT,
    MAX_PAGE_SIZE,
)
from core.database import get_sb
from core.errors import CLUB_EVENT_CREATION_REQUIRED, CLUB_PENDING_REVIEW
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.pagination import apply_stable_order
from core.sanitize import sanitize_postgrest_value
from core.tables import (
    CLUB_MEMBERS,
    CLUBS,
    USERS,
)
from schemas.club import (
    CLUB_STATUS_APPROVED,
    CLUB_STATUS_PENDING,
    ClubCreate,
    ClubMemberResponse,
    ClubResponse,
    ClubUpdate,
)
from schemas.user import UserResponse
from services import position_service, school_service
from services.event_feed_revalidation import event_feed_revalidation_service

_CLUB_SELECT = f"*,event_count,{school_service.SCHOOL_SLUG_EMBED}"


def _club_response(row: dict, *, owner_email: str | None = None) -> ClubResponse:
    return ClubResponse.model_validate(
        {
            **school_service.with_school_slug(row),
            "owner_email": owner_email,
        }
    )


def _normalize_club_name(name: str | None) -> str:
    return " ".join((name or "").casefold().split())


def lookup_club_by_school_and_name(school: str, name: str) -> dict | None:
    """Return the club matching ``school`` + normalized display name.

    Exact normalized match only (casefold + whitespace collapse). When multiple
    rows normalize to the same name, pick the lowest id so callers stay
    deterministic. Returns ``None`` on miss or empty inputs.
    """
    school_slug = (school or "").strip()
    target = _normalize_club_name(name)
    if not school_slug or not target:
        return None
    school_record = school_service.get_school(school_slug)
    if school_record is None:
        return None

    rows = _get_clubs_for_school_lookup(school_record.id)

    matches = [row for row in rows if _normalize_club_name(row.get("club_name")) == target]
    if not matches:
        return None
    return school_service.with_school_slug(matches[0])


def lookup_club_by_school_and_ig(school: str, handle: str) -> dict | None:
    """Look up a verified handle within the same cached school directory."""
    school_id = school_service.get_school_id(school)
    if school_id is None:
        return None
    target = handle.strip().lstrip("@").casefold()
    matches = [
        row
        for row in _get_clubs_for_school_lookup(school_id)
        if (row.get("ig") or "").strip().lstrip("@").casefold() == target
    ]
    return school_service.with_school_slug(matches[0]) if len(matches) == 1 else None


@functools.lru_cache(maxsize=16)
def _get_clubs_for_school_lookup(school_id: int) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        page = (
            get_sb()
            .table(CLUBS)
            .select(f"id,club_name,club_type,ig,logo_url,{school_service.SCHOOL_SLUG_EMBED}")
            .eq("school_id", school_id)
            .order("id", desc=False)
            .range(offset, offset + MAX_PAGE_SIZE - 1)
            .execute()
        ).data or []
        rows.extend(page)
        if len(page) < MAX_PAGE_SIZE:
            return rows
        offset += len(page)


def _fetch_owner_email(user_id: str | None) -> str | None:
    if not user_id:
        return None
    try:
        user_row = get_sb().table("users").select("email").eq("id", user_id).execute()
        if user_row.data and isinstance(user_row.data, list) and len(user_row.data) > 0:
            first_row = user_row.data[0]
            if isinstance(first_row, dict):
                email = first_row.get("email")
                if isinstance(email, str):
                    return email
    except Exception as e:
        log.warning("Failed to fetch owner email for %s: %s", user_id, e)
    return None


def list_clubs_by_owner(owner_id: str) -> list[ClubResponse]:
    """Return all clubs where the user is a member/manager."""
    clubs_dict = {}

    try:
        r_members = (
            get_sb()
            .table(CLUB_MEMBERS)
            .select(f"clubs(*,{school_service.SCHOOL_SLUG_EMBED})")
            .eq("user_id", owner_id)
            .execute()
        )
        for row in r_members.data or []:
            if row.get("clubs"):
                club_data = row["clubs"]
                email = _fetch_owner_email(club_data.get("created_by"))
                club = _club_response(club_data, owner_email=email)
                clubs_dict[club.id] = club
    except Exception as e:
        log.warning("Failed to query club_members for owner_id %s: %s", owner_id, e)

    return list(clubs_dict.values())


def publish_refusal(club: ClubResponse, db_user: UserResponse) -> str | None:
    """Why *db_user* may not publish under *club* without review, or None when they may.

    Admins may. Otherwise management-team membership alone is not enough: the
    club itself must have cleared admin review, so submitting a club is never a
    route to publishing events or positions without moderation.
    """
    if is_admin(db_user):
        return None
    if club.status != CLUB_STATUS_APPROVED:
        return CLUB_PENDING_REVIEW
    if not any(c.id == club.id for c in list_clubs_by_owner(str(db_user.id))):
        return CLUB_EVENT_CREATION_REQUIRED
    return None


def add_club_member(club_id: int, user_id: UUID) -> ClubMemberResponse:
    """Add a user as a member of the club. Members always follow their club."""
    from services import saved_club_service, user_service

    user = user_service.get_user(user_id)
    if not user:
        raise NotFoundError("User not found")
    saved_club_service.save_club(str(user_id), club_id)

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "club_id": club_id,
        "user_id": str(user_id),
        "joined_at": now,
    }

    try:
        r = get_sb().table(CLUB_MEMBERS).insert(payload).execute()
    except APIError as e:
        if e.code == "23505":
            raise ConflictError("User is already a member of this club")
        raise

    if not r.data:
        raise APIError("Failed to add club member")

    inserted = r.data[0]
    return ClubMemberResponse(
        user_id=user_id,
        email=user.email,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        role="Member",
        joined_at=datetime.fromisoformat(inserted["joined_at"]),
    )


def get_club(club_id: int) -> ClubResponse | None:
    r = get_sb().table(CLUBS).select(_CLUB_SELECT).eq("id", club_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    email = _fetch_owner_email(r.data[0].get("created_by"))
    return _club_response(r.data[0], owner_email=email)


def list_clubs(
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    club_type: str | None = None,
    search: str | None = None,
    school: str | None = None,
    categories: list[str] | None = None,
    ids: list[int] | None = None,
    status: str | None = CLUB_STATUS_APPROVED,
    min_events: int = 0,
) -> tuple[list[ClubResponse], int]:
    """List clubs. Defaults to approved only; pass ``status=None`` for
    every review state (admin review queues)."""
    q = get_sb().table(CLUBS).select(_CLUB_SELECT, count="exact")
    if status is not None:
        q = q.eq("status", status)
    if ids is not None:
        if not ids:
            return [], 0
        q = q.in_("id", ids)
    if club_type is not None:
        q = q.eq("club_type", club_type)
    if school:
        school_record = school_service.get_school(school)
        if school_record is None:
            return [], 0
        q = q.eq("school_id", school_record.id)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            q = q.ilike("club_name", f"%{term}%")
    if categories:
        # JSONB containment per category, ORed to match any selected category.
        q = q.or_(
            ",".join(
                f"categories.cs.{json.dumps(json.dumps([category]))}" for category in categories
            )
        )
    if min_events:
        q = q.gte("event_count", min_events)
    q = apply_stable_order(q, "club_name", desc=False).range(skip, skip + limit - 1)
    r = q.execute()
    items = _clubs_with_owner_emails(r.data or [])

    if items:
        club_ids = [item.id for item in items]
        position_counts = position_service.get_club_position_counts(club_ids)
        items = [
            item.model_copy(
                update={
                    "position_count": position_counts.get(item.id, 0),
                }
            )
            for item in items
        ]

    return items, r.count or len(items)


def create_club(
    data: ClubCreate, *, created_by: str | None, auto_approve: bool = False
) -> ClubResponse:
    """Create a club. Non-admin submissions land in the review queue."""
    payload = data.model_dump()
    school_record = school_service.get_school(payload.pop("school"))
    if school_record is None:
        raise ValidationError("School is not registered")
    payload["school_id"] = school_record.id
    payload["created_by"] = created_by
    payload["submitted"] = True
    payload["status"] = CLUB_STATUS_APPROVED if auto_approve else CLUB_STATUS_PENDING
    r = get_sb().table(CLUBS).insert(payload).execute()
    club = get_club(int(r.data[0]["id"]))
    if club is None:
        raise RuntimeError("Created club could not be reloaded")
    if created_by is not None:
        try:
            add_club_member(club.id, UUID(created_by))
        except Exception as e:
            log.warning("Failed to auto-add creator %s to club members: %s", created_by, e)
    _get_clubs_for_school_lookup.cache_clear()
    if auto_approve:
        event_feed_revalidation_service.revalidate_school(club.school, resources=("clubs",))
    return club


def update_club(club_id: int, data: ClubUpdate) -> ClubResponse | None:
    existing = get_club(club_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    if "school" in payload:
        updated_school = payload.pop("school")
        school_record = school_service.get_school(updated_school)
        if school_record is None:
            raise ValidationError("School is not registered")
        payload["school_id"] = school_record.id
    else:
        updated_school = existing.school
    r = get_sb().table(CLUBS).update(payload).eq("id", club_id).execute()
    if r.data:
        updated = _club_response({**r.data[0], "school": updated_school})
        _get_clubs_for_school_lookup.cache_clear()
        # These fields are embedded by the event and position read models.
        changes_embedded_fields = any(
            getattr(updated, field) != getattr(existing, field)
            for field in (
                "club_name",
                "club_type",
                "logo_url",
                "school",
                "club_page",
                "ig",
                "discord",
            )
        )
        event_feed_revalidation_service.revalidate_schools(
            [existing.school, updated.school],
            resources=("events", "positions", "clubs") if changes_embedded_fields else ("clubs",),
        )
        return updated
    return None


# --- Club Claims ---


def _clubs_with_owner_emails(rows: list[dict]) -> list[ClubResponse]:
    owner_ids = list({row["created_by"] for row in rows if row.get("created_by")})
    owners = (
        get_sb().table(USERS).select("id,email").in_("id", owner_ids).execute().data
        if owner_ids
        else []
    )
    emails = {row["id"]: row.get("email") for row in owners or []}
    return [_club_response(row, owner_email=emails.get(row.get("created_by"))) for row in rows]
