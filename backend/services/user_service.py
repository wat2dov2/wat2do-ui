"""Users (profile table) via Supabase. Sync."""

import base64
import hashlib
from datetime import datetime, timezone
from itertools import batched
from uuid import UUID

from core.constants import DEFAULT_LIST_LIMIT
from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    PROMOTER_PROGRAM_PAUSED,
    PROMOTER_SCHOOL_REQUIRED,
    PROMOTER_TOS_REQUIRED,
    USER_HAS_PAYOUT_REVIEWS,
    USER_HAS_PAYOUTS,
    USER_HAS_PROMOTER_POSTERS,
)
from core.exceptions import ValidationError
from core.tables import POSTER_PAYOUT_REVIEWS, POSTER_PAYOUTS, QR_CODES, USERS
from schemas.user import PromoterEnrollmentUpdate, UserResponse, UserUpdate
from services import school_service
from services.school_context import canonical_school_key

_USER_SELECT = f"*,{school_service.SCHOOL_SLUG_EMBED}"


def avatar_url_for_user(user_id: str, avatar_url: str | None = None) -> str:
    """Preserve uploaded photos, otherwise generate a stable, private identicon."""
    if avatar_url:
        return avatar_url
    digest = hashlib.sha256(user_id.encode()).digest()
    color = f"hsl({int.from_bytes(digest[:2]) % 360} 55% 42%)"
    cells = []
    for y in range(5):
        for x in range(3):
            if digest[2 + y * 3 + x] & 1:
                for column in {x, 4 - x}:
                    cells.append(f"M{10 + column * 16} {10 + y * 16}h16v16h-16z")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#f1f5f9"/>'
        f'<path fill="{color}" d="{"".join(cells)}"/></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _user_response(row: dict) -> UserResponse:
    return UserResponse.model_validate(
        {
            **school_service.with_school_slug(row),
            "avatar_url": avatar_url_for_user(str(row["id"]), row.get("avatar_url")),
        }
    )


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select(_USER_SELECT).eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return _user_response(r.data[0])


def get_user_by_email(email: str) -> UserResponse | None:
    r = get_sb().table(USERS).select(_USER_SELECT).eq("email", email).execute()
    if not r.data or len(r.data) == 0:
        return None
    return _user_response(r.data[0])


def get_user_by_supabase_id(supabase_auth_id: str) -> UserResponse | None:
    r = (
        get_sb()
        .table(USERS)
        .select(_USER_SELECT)
        .eq("supabase_auth_id", supabase_auth_id)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return None
    return _user_response(r.data[0])


_LOAD_PAGE_SIZE = 1000


def get_users_by_ids(user_ids: list[str]) -> dict[str, UserResponse]:
    """Fetch profiles in bounded ID batches, omitting missing users."""
    if not user_ids:
        return {}

    result: dict[str, UserResponse] = {}

    for chunk in batched(user_ids, _LOAD_PAGE_SIZE):
        r = get_sb().table(USERS).select(_USER_SELECT).in_("id", chunk).execute()
        for row in r.data or []:
            user = _user_response(row)
            result[str(user.id)] = user

    return result


def list_users(skip: int = 0, limit: int = DEFAULT_LIST_LIMIT) -> list[UserResponse]:
    r = (
        get_sb()
        .table(USERS)
        .select(_USER_SELECT)
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return [_user_response(u) for u in (r.data or [])]


def update_user(user_id: UUID, data: UserUpdate) -> UserResponse | None:
    existing = get_user(user_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    school_changed = "school" in payload
    school = None
    if "school" in payload:
        school = school_service.get_school(canonical_school_key(payload.pop("school")))
        if school is None:
            raise ValidationError("School is not registered")
        payload["school_id"] = school.id
    if payload.get("faculty"):
        school = school or school_service.get_school(canonical_school_key(existing.school))
        if school is None or payload["faculty"] not in school.faculties:
            raise ValidationError("Faculty is not offered by the selected school")
    elif school_changed and "faculty" not in payload and school is not None:
        if existing.faculty not in school.faculties:
            payload["faculty"] = None
    r = get_sb().table(USERS).update(payload).eq("id", str(user_id)).execute()
    if not r.data:
        return None
    return _user_response({**r.data[0], "school": data.school or existing.school})


def update_promoter_enrollment(
    user_id: UUID,
    data: PromoterEnrollmentUpdate,
) -> UserResponse | None:
    """Enroll a user or update an existing promoter payout email.

    The acceptance metadata is server-owned and is only set during enrollment.
    """
    existing = get_user(user_id)
    if existing is None:
        return None

    is_enrolled = (
        existing.payout_email is not None
        and existing.promoter_tos_accepted_at is not None
        and existing.promoter_tos_version is not None
    )
    if not is_enrolled:
        school = canonical_school_key(existing.school)
        if not school_service.school_exists(school):
            raise ValidationError(PROMOTER_SCHOOL_REQUIRED)
        if not controlbox.promoter_program.enabled:
            raise ValidationError(PROMOTER_PROGRAM_PAUSED)

    must_accept = not is_enrolled
    if must_accept and not data.accept_tos:
        raise ValidationError(PROMOTER_TOS_REQUIRED)

    payload: dict[str, object] = {"payout_email": str(data.payout_email)}
    if must_accept:
        payload.update(
            {
                "promoter_tos_accepted_at": datetime.now(timezone.utc).isoformat(),
                "promoter_tos_version": controlbox.promoter_program.tos_version,
            }
        )

    r = get_sb().table(USERS).update(payload).eq("id", str(user_id)).execute()
    return _user_response({**r.data[0], "school": existing.school}) if r.data else None


def set_role(user_id: UUID, role: str) -> UserResponse | None:
    """Admin-only role rotation.

    Updates the ``role`` column directly (bypassing ``UserUpdate`` which
    intentionally does not list ``role`` - see schema audit S2).
    """
    existing = get_user(user_id)
    if existing is None:
        return None
    r = get_sb().table(USERS).update({"role": role}).eq("id", str(user_id)).execute()
    return get_user(user_id) if r.data else None


def count_admins() -> int:
    """Return the number of users with the admin role.

    Used by admin-only routes to enforce an admin-quorum invariant: the
    system must never reach a state with zero admins (a bored admin could
    otherwise lock the platform into a permanently un-administered state -
    see audit A26).  Uses PostgREST's ``count="exact"`` to avoid fetching
    the full user list.
    """
    r = get_sb().table(USERS).select("id", count="exact").eq("role", "admin").execute()
    return r.count or 0


def delete_user(user_id: UUID) -> bool:
    payout_response = (
        get_sb()
        .table(POSTER_PAYOUTS)
        .select("id", count="exact")
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    if payout_response.count or payout_response.data:
        raise ValidationError(USER_HAS_PAYOUTS)
    poster_response = (
        get_sb()
        .table(QR_CODES)
        .select("id", count="exact")
        .eq("created_by", str(user_id))
        .eq("program", "promoter")
        .limit(1)
        .execute()
    )
    if poster_response.count or poster_response.data:
        raise ValidationError(USER_HAS_PROMOTER_POSTERS)
    review_response = (
        get_sb()
        .table(POSTER_PAYOUT_REVIEWS)
        .select("id", count="exact")
        .eq("reviewed_by", str(user_id))
        .limit(1)
        .execute()
    )
    if review_response.count or review_response.data:
        raise ValidationError(USER_HAS_PAYOUT_REVIEWS)
    r = get_sb().table(USERS).delete().eq("id", str(user_id)).execute()
    return bool(r.data)
