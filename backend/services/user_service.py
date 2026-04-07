"""Users (profile table) via Supabase. Sync."""

from uuid import UUID

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.tables import USERS
from schemas.user import UserUpdate, UserResponse


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


def get_user_by_supabase_id(supabase_auth_id: str) -> UserResponse | None:
    r = get_sb().table(USERS).select("*").eq("supabase_auth_id", supabase_auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return UserResponse.model_validate(r.data[0])


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


def delete_user(user_id: UUID) -> bool:
    r = get_sb().table(USERS).delete().eq("id", str(user_id)).execute()
    return bool(r.data)
