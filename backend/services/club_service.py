"""Clubs via Supabase. Sync."""

from core.database import get_sb
from schemas.club import ClubCreate, ClubUpdate


def get_club(club_id: int) -> dict | None:
    r = get_sb().table("clubs").select("*").eq("id", club_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return r.data[0]


def list_clubs(
    skip: int = 0,
    limit: int = 100,
    club_type: str | None = None,
    search: str | None = None,
) -> list[dict]:
    q = get_sb().table("clubs").select("*")
    if club_type:
        q = q.eq("club_type", club_type)
    if search:
        q = q.ilike("club_name", f"%{search}%")
    q = q.order("club_name").range(skip, skip + limit - 1)
    r = q.execute()
    return r.data or []


def create_club(data: ClubCreate) -> dict:
    payload = data.model_dump()
    r = get_sb().table("clubs").insert(payload).execute()
    return r.data[0]


def update_club(club_id: int, data: ClubUpdate) -> dict | None:
    if get_club(club_id) is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    r = get_sb().table("clubs").update(payload).eq("id", club_id).execute()
    return r.data[0] if r.data else None


def delete_club(club_id: int) -> bool:
    r = get_sb().table("clubs").delete().eq("id", club_id).execute()
    return bool(r.data)
