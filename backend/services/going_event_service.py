"""Going events: persist user RSVP-style interest to Supabase."""

import logging
import uuid
from collections import Counter
from datetime import datetime, timezone

from core.cache import TTLCache
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENTS, USER_GOING_EVENTS
from schemas.going_event import GoingEventResponse, UserEventPair

# 30-minute TTL for shared recommendation data (matches recommender config)
CACHE_TTL_SECONDS = 1800

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Simple TTL cache for get_all_user_goings (shared across recommendation requests)
# ---------------------------------------------------------------------------
_goings_cache = TTLCache(default_ttl=CACHE_TTL_SECONDS)


def get_going_event_ids(user_id: str) -> list[int]:
    """Return event IDs this user is going to."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("event_id")
                .eq("user_id", user_id)
                .order("going_at", desc=True)
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    )
    return [row["event_id"] for row in rows]


def count_going_events(user_id: str) -> int:
    """Return the total number of events this user is going to.

    Used by the going endpoint to enforce ``MAX_GOING_EVENTS_PER_USER``
    without materialising the full list.
    """
    r = (
        get_sb()
        .table(USER_GOING_EVENTS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def count_going_for_event(event_id: int) -> int:
    """Return how many users are going to a single event."""
    r = (
        get_sb()
        .table(USER_GOING_EVENTS)
        .select("id", count="exact")
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def get_going_counts_for_school(school: str) -> dict[str, int]:
    """Return ``{eventId: count}`` for all events at ``school``.

    Public overlay for the browse feed. Keys are strings so the JSON map
    stays stable across OpenAPI clients.
    """
    event_rows = fetch_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(EVENTS)
                .select("id")
                .eq("school", school)
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    )
    event_ids = [row["id"] for row in event_rows]
    if not event_ids:
        return {}

    counts: Counter[int] = Counter()
    # Chunk IN filters to stay under PostgREST URL limits.
    chunk_size = 200
    for i in range(0, len(event_ids), chunk_size):
        chunk = event_ids[i : i + chunk_size]
        rows = fetch_all_pages(
            lambda offset, ps, ids=chunk: (
                (
                    get_sb()
                    .table(USER_GOING_EVENTS)
                    .select("event_id")
                    .in_("event_id", ids)
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
        counts.update(row["event_id"] for row in rows)

    return {str(eid): counts[eid] for eid in event_ids if counts[eid] > 0}


def _get_going_row(user_id: str, event_id: int) -> GoingEventResponse | None:
    """Return the existing ``user_going_events`` row for (user_id, event_id)."""
    r = (
        get_sb()
        .table(USER_GOING_EVENTS)
        .select("*")
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    if r.data:
        return GoingEventResponse.model_validate(r.data[0])
    return None


def mark_going(user_id: str, event_id: int) -> GoingEventResponse:
    """Mark an event as going for the user, idempotently.

    - If a row already exists for (user_id, event_id), return it as-is.
    - Otherwise insert a new row with a newly-minted UUID.

    The ``unique(user_id, event_id)`` constraint on the table is the
    ultimate guarantee of uniqueness.
    """
    existing = _get_going_row(user_id, event_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    r = get_sb().table(USER_GOING_EVENTS).insert(payload).execute()
    if r.data:
        return GoingEventResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for mark_going(user_id=%s, event_id=%s), using payload fallback",
        user_id,
        event_id,
    )
    return GoingEventResponse(**payload, going_at=datetime.now(timezone.utc))


def unmark_going(user_id: str, event_id: int) -> bool:
    """Remove a going mark. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(USER_GOING_EVENTS)
        .delete()
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .execute()
    )
    return bool(r.data)


def get_all_user_goings() -> list[UserEventPair]:
    """Return all (user_id, event_id) pairs. Used by collaborative filtering.

    Cached for CACHE_TTL_SECONDS so concurrent recommendation requests
    share one DB round-trip.
    """

    def _fetch_all_goings() -> list[UserEventPair]:
        rows = fetch_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(USER_GOING_EVENTS)
                    .select("user_id, event_id")
                    .order("going_at")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
        return [UserEventPair.model_validate(row) for row in rows]

    return _goings_cache.get_or_compute("all_user_goings", _fetch_all_goings)  # type: ignore[return-value]
