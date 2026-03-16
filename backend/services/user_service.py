"""Users (profile table) via Supabase. Sync."""

from uuid import UUID

from core.database import get_sb
from schemas.user import UserUpdate


def get_user(user_id: UUID) -> dict | None:
    r = get_sb().table("users").select("*").eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return r.data[0]


def get_user_by_supabase_id(supabase_auth_id: str) -> dict | None:
    r = get_sb().table("users").select("*").eq("supabase_auth_id", supabase_auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return r.data[0]


def list_users(skip: int = 0, limit: int = 100) -> list[dict]:
    r = (
        get_sb()
        .table("users")
        .select("*")
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return r.data or []


def update_user(user_id: UUID, data: UserUpdate) -> dict | None:
    if get_user(user_id) is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    r = get_sb().table("users").update(payload).eq("id", str(user_id)).execute()
    return r.data[0] if r.data else None


def delete_user(user_id: UUID) -> bool:
    r = get_sb().table("users").delete().eq("id", str(user_id)).execute()
    return bool(r.data)
