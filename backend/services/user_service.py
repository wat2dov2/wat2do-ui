"""Users (profile table) via Supabase. Sync."""

from uuid import UUID

from cachetools import TTLCache

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.tables import USERS
from schemas.user import UserUpdate, UserResponse

# Short-lived cache for get_user_by_supabase_id to avoid redundant DB
# round-trips when multiple endpoints resolve the same user in parallel.
_supabase_id_cache: TTLCache = TTLCache(maxsize=256, ttl=60)


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


def get_user_by_supabase_id(supabase_auth_id: str) -> UserResponse | None:
    cached = _supabase_id_cache.get(supabase_auth_id)
    if cached is not None:
        return cached
    r = get_sb().table(USERS).select("*").eq("supabase_auth_id", supabase_auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    user = UserResponse.model_validate(r.data[0])
    _supabase_id_cache[supabase_auth_id] = user
    return user


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


def delete_user(user_id: UUID) -> bool:
    _supabase_id_cache.clear()
    r = get_sb().table(USERS).delete().eq("id", str(user_id)).execute()
    return bool(r.data)
