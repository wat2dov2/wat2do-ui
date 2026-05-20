"""Users (profile table) via Supabase. Sync."""

from uuid import UUID

from cachetools import TTLCache

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.tables import USERS
from schemas.user import UserResponse, UserUpdate

# Short-lived cache for get_user_by_supabase_id to avoid redundant DB
# round-trips when multiple endpoints resolve the same user in parallel.
_supabase_id_cache: TTLCache = TTLCache(maxsize=256, ttl=60)


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


def get_user_by_supabase_id(
    supabase_auth_id: str,
    *,
    bypass_cache: bool = False,
) -> UserResponse | None:
    if not bypass_cache:
        cached = _supabase_id_cache.get(supabase_auth_id)
        if cached is not None:
            return cached
    r = get_sb().table(USERS).select("*").eq("supabase_auth_id", supabase_auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    user = UserResponse.model_validate(r.data[0])
    _supabase_id_cache[supabase_auth_id] = user
    return user


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
    _supabase_id_cache.clear()
    r = get_sb().table(USERS).update(payload).eq("id", str(user_id)).execute()
    return UserResponse.model_validate(r.data[0]) if r.data else None


def set_role(user_id: UUID, role: str) -> UserResponse | None:
    """Admin-only role rotation.

    Updates the ``role`` column directly (bypassing ``UserUpdate`` which
    intentionally does not list ``role`` — see schema audit S2).  Clears
    the supabase-auth-id cache so ``_check_admin`` sees the new role
    immediately.
    """
    existing = get_user(user_id)
    if existing is None:
        return None
    _supabase_id_cache.clear()
    r = get_sb().table(USERS).update({"role": role}).eq("id", str(user_id)).execute()
    return UserResponse.model_validate(r.data[0]) if r.data else None


def count_admins() -> int:
    """Return the number of users with the admin role.

    Used by admin-only routes to enforce an admin-quorum invariant: the
    system must never reach a state with zero admins (a bored admin could
    otherwise lock the platform into a permanently un-administered state —
    see audit A26).  Uses PostgREST's ``count="exact"`` to avoid fetching
    the full user list.
    """
    r = get_sb().table(USERS).select("id", count="exact").eq("role", "admin").execute()
    return r.count or 0


def delete_user(user_id: UUID) -> bool:
    _supabase_id_cache.clear()
    r = get_sb().table(USERS).delete().eq("id", str(user_id)).execute()
    return bool(r.data)
