"""Users (profile table) via Supabase. Sync."""

from datetime import datetime, timezone
from uuid import UUID

from core.constants import DEFAULT_LIST_LIMIT
from core.constants.school_mappings import SCHOOLS
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
from services.school_context import canonical_school_key


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


def get_user_by_email(email: str) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("email", email).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


def get_user_by_supabase_id(supabase_auth_id: str) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("supabase_auth_id", supabase_auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


_LOAD_PAGE_SIZE = 1000


def get_users_by_ids(user_ids: list[str]) -> dict[str, UserResponse]:
    """Batch-fetch user profiles by ID.

    Returns {user_id: UserResponse} for the given IDs. Missing users are
    omitted. Paginates internally to avoid PostgREST's server-side
    ``max-rows`` truncation.
    """
    if not user_ids:
        return {}

    result: dict[str, UserResponse] = {}

    # PostgREST IN-clause has practical limits, so chunk the IDs.
    for chunk_start in range(0, len(user_ids), _LOAD_PAGE_SIZE):
        chunk = user_ids[chunk_start : chunk_start + _LOAD_PAGE_SIZE]
        r = get_sb().table(USERS).select("*").in_("id", chunk).execute()
        for row in r.data or []:
            user = UserResponse.model_validate(row)
            result[str(user.id)] = user

    return result


def list_users(skip: int = 0, limit: int = DEFAULT_LIST_LIMIT) -> list[UserResponse]:
    r = (
        get_sb()
        .table(USERS)
        .select("*")
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return [UserResponse.model_validate(u) for u in (r.data or [])]


def update_user(user_id: UUID, data: UserUpdate) -> UserResponse | None:
    existing = get_user(user_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    r = get_sb().table(USERS).update(payload).eq("id", str(user_id)).execute()
    return UserResponse.model_validate(r.data[0]) if r.data else None


def update_promoter_enrollment(
    user_id: UUID,
    data: PromoterEnrollmentUpdate,
) -> UserResponse | None:
    """Enroll a user or update an existing promoter payout email.

    The acceptance timestamp is server-owned and is only changed when the
    current ToS version has not yet been accepted.
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
        if not school or school not in SCHOOLS:
            raise ValidationError(PROMOTER_SCHOOL_REQUIRED)
        if not controlbox.promoter_program.enabled:
            raise ValidationError(PROMOTER_PROGRAM_PAUSED)

    current_version = controlbox.promoter_program.tos_version
    must_accept = (
        existing.promoter_tos_accepted_at is None
        or existing.promoter_tos_version != current_version
    )
    if must_accept and not data.accept_tos:
        raise ValidationError(PROMOTER_TOS_REQUIRED)

    payload: dict[str, object] = {"payout_email": str(data.payout_email)}
    if must_accept:
        payload.update(
            {
                "promoter_tos_accepted_at": datetime.now(timezone.utc).isoformat(),
                "promoter_tos_version": current_version,
            }
        )

    r = get_sb().table(USERS).update(payload).eq("id", str(user_id)).execute()
    return UserResponse.model_validate(r.data[0]) if r.data else None


def set_role(user_id: UUID, role: str) -> UserResponse | None:
    """Admin-only role rotation.

    Updates the ``role`` column directly (bypassing ``UserUpdate`` which
    intentionally does not list ``role`` - see schema audit S2).
    """
    existing = get_user(user_id)
    if existing is None:
        return None
    r = get_sb().table(USERS).update({"role": role}).eq("id", str(user_id)).execute()
    return UserResponse.model_validate(r.data[0]) if r.data else None


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
