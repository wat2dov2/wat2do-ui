"""Saved events: persist user bookmarks to Supabase."""

import logging
import threading
import time
import uuid

from core.database import get_sb
from core.tables import USER_SAVED_EVENTS
from schemas.saved_event import SavedEventResponse, UserEventPair
from services.recommender.config import CACHE_TTL_SECONDS

log = logging.getLogger(__name__)

# Page size for batched loading from PostgREST.  Supabase's default max-rows
# is 1000 — queries without an explicit limit are silently truncated there.
_LOAD_PAGE_SIZE = 1000

# ---------------------------------------------------------------------------
# Simple TTL cache for get_all_user_saves (shared across recommendation requests)
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_saves_cache: tuple[float, list[UserEventPair]] | None = None


def get_saved_event_ids(user_id: str) -> list[int]:
    """Return event IDs saved by this user.

    Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
    by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
    """
    ids: list[int] = []
    offset = 0
    while True:
        r = (
            get_sb()
            .table(USER_SAVED_EVENTS)
            .select("event_id")
            .eq("user_id", user_id)
            .order("saved_at", desc=True)
            .range(offset, offset + _LOAD_PAGE_SIZE - 1)
            .execute()
        )
        page = r.data or []
        ids.extend(row["event_id"] for row in page)
        if len(page) < _LOAD_PAGE_SIZE:
            break
        offset += _LOAD_PAGE_SIZE
    return ids


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

    Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
    by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
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

        # Paginate to avoid silent truncation at PostgREST's max-rows limit.
        rows: list[dict] = []
        offset = 0
        while True:
            r = (
                get_sb()
                .table(USER_SAVED_EVENTS)
                .select("user_id, event_id")
                .order("saved_at")
                .range(offset, offset + _LOAD_PAGE_SIZE - 1)
                .execute()
            )
            page = r.data or []
            rows.extend(page)
            if len(page) < _LOAD_PAGE_SIZE:
                break
            offset += _LOAD_PAGE_SIZE

        result = [UserEventPair.model_validate(row) for row in rows]
        _saves_cache = (time.monotonic() + CACHE_TTL_SECONDS, result)
        return result
