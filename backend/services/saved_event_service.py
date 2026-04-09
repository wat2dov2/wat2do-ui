"""Saved events: persist user bookmarks to Supabase."""

import logging
import threading
import time
import uuid

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_SAVED_EVENTS
from schemas.saved_event import SavedEventResponse, UserEventPair
from services.recommender.config import CACHE_TTL_SECONDS

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Simple TTL cache for get_all_user_saves (shared across recommendation requests)
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_saves_cache: tuple[float, list[UserEventPair]] | None = None


def get_saved_event_ids(user_id: str) -> list[int]:
    """Return event IDs saved by this user."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            get_sb()
            .table(USER_SAVED_EVENTS)
            .select("event_id")
            .eq("user_id", user_id)
            .order("saved_at", desc=True)
            .range(offset, offset + ps - 1)
            .execute()
        ).data or [],
    )
    return [row["event_id"] for row in rows]


def save_event(user_id: str, event_id: int) -> SavedEventResponse:
    """Save an event for the user. Upsert to handle duplicates."""
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    r = (
        get_sb()
        .table(USER_SAVED_EVENTS)
        .upsert(payload, on_conflict="user_id,event_id")
        .execute()
    )
    return SavedEventResponse.model_validate(r.data[0]) if r.data else SavedEventResponse(**payload)


def unsave_event(user_id: str, event_id: int) -> bool:
    """Remove a saved event. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(USER_SAVED_EVENTS)
        .delete()
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .execute()
    )
    return bool(r.data)


def get_all_user_saves() -> list[UserEventPair]:
    """Return all (user_id, event_id) pairs. Used by collaborative filtering.

    Cached for CACHE_TTL_SECONDS so concurrent recommendation requests
    share one DB round-trip.
    """
    global _saves_cache

    if _saves_cache is not None:
        expires_at, value = _saves_cache
        if time.monotonic() <= expires_at:
            return value

    with _cache_lock:
        # Double-check after acquiring lock
        if _saves_cache is not None:
            expires_at, value = _saves_cache
            if time.monotonic() <= expires_at:
                return value

        rows = fetch_all_pages(
            lambda offset, ps: (
                get_sb()
                .table(USER_SAVED_EVENTS)
                .select("user_id, event_id")
                .order("saved_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data or [],
        )
        result = [UserEventPair.model_validate(row) for row in rows]
        _saves_cache = (time.monotonic() + CACHE_TTL_SECONDS, result)
        return result
