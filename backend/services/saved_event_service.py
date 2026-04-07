"""Saved events: persist user bookmarks to Supabase."""

import uuid

from core.database import get_sb


def get_saved_event_ids(user_id: str) -> list[int]:
    """Return event IDs saved by this user."""
    r = (
        get_sb()
        .table("user_saved_events")
        .select("event_id")
        .eq("user_id", user_id)
        .order("saved_at", desc=True)
        .execute()
    )
    return [row["event_id"] for row in (r.data or [])]


def save_event(user_id: str, event_id: int) -> dict:
    """Save an event for the user. Upsert to handle duplicates."""
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    r = (
        get_sb()
        .table("user_saved_events")
        .upsert(payload, on_conflict="user_id,event_id")
        .execute()
    )
    return r.data[0] if r.data else payload


def unsave_event(user_id: str, event_id: int) -> bool:
    """Remove a saved event. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table("user_saved_events")
        .delete()
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .execute()
    )
    return bool(r.data)


def get_all_user_saves() -> list[dict]:
    """Return all (user_id, event_id) pairs. Used by collaborative filtering."""
    r = (
        get_sb()
        .table("user_saved_events")
        .select("user_id, event_id")
        .execute()
    )
    return r.data or []
