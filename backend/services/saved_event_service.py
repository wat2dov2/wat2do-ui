"""Saved events: persist user bookmarks to Supabase."""

import logging
import uuid
from datetime import datetime, timezone

from core.cache import TTLCache
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_SAVED_EVENTS
from schemas.saved_event import SavedEventResponse, UserEventPair

# 30-minute TTL for shared recommendation data (matches recommender config)
CACHE_TTL_SECONDS = 1800

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Simple TTL cache for get_all_user_saves (shared across recommendation requests)
# ---------------------------------------------------------------------------
_saves_cache = TTLCache(default_ttl=CACHE_TTL_SECONDS)


def get_saved_event_ids(user_id: str) -> list[int]:
    """Return event IDs saved by this user."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_SAVED_EVENTS)
                .select("event_id")
                .eq("user_id", user_id)
                .order("saved_at", desc=True)
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    )
    return [row["event_id"] for row in rows]


def count_saved_events(user_id: str) -> int:
    """Return the total number of events this user has saved.

    Used by the save endpoint to enforce ``MAX_SAVED_EVENTS_PER_USER``
    without materialising the full list.
    """
    r = (
        get_sb()
        .table(USER_SAVED_EVENTS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def _get_saved_row(user_id: str, event_id: int) -> SavedEventResponse | None:
    """Return the existing ``user_saved_events`` row for (user_id, event_id)."""
    r = (
        get_sb()
        .table(USER_SAVED_EVENTS)
        .select("*")
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    if r.data:
        return SavedEventResponse.model_validate(r.data[0])
    return None


def save_event(user_id: str, event_id: int) -> SavedEventResponse:
    """Save an event for the user, idempotently.

    Historical behaviour used ``.upsert`` with a fresh UUID on every call,
    which churned the primary key and broke any downstream consumer that
    keyed on the save row's ``id`` (audit D20).

    New behaviour:
    - If a row already exists for (user_id, event_id), return it as-is.
    - Otherwise insert a new row with a newly-minted UUID.

    The ``unique(user_id, event_id)`` constraint on the table is the
    ultimate guarantee of uniqueness; this function is the clean path
    that avoids the unnecessary upsert round-trip.
    """
    existing = _get_saved_row(user_id, event_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    r = get_sb().table(USER_SAVED_EVENTS).insert(payload).execute()
    if r.data:
        return SavedEventResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for save_event(user_id=%s, event_id=%s), using payload fallback",
        user_id,
        event_id,
    )
    return SavedEventResponse(**payload, saved_at=datetime.now(timezone.utc))


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

    def _fetch_all_saves() -> list[UserEventPair]:
        rows = fetch_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(USER_SAVED_EVENTS)
                    .select("user_id, event_id")
                    .order("saved_at")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
        return [UserEventPair.model_validate(row) for row in rows]

    return _saves_cache.get_or_compute("all_user_saves", _fetch_all_saves)  # type: ignore[return-value]
