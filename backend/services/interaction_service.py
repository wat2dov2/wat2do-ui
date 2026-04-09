"""User-event interaction tracking and aggregation."""

import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from core.constants import (
    DEFAULT_INTERACTION_LIMIT,
    DEDUP_WINDOW_MINUTES,
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_SAVE,
    INTERACTION_SHARE,
    INTERACTION_UNSAVE,
    INTERACTION_VIEW,
    MAX_DUPLICATE_INTERACTIONS,
    MAX_USER_INTERACTIONS_PER_WINDOW,
)
from core.database import get_sb
from core.tables import USER_INTERACTIONS
from schemas.interaction import InteractionCreate, InteractionMatrixRow, EventPopularity
from services.recommender.config import (
    CACHE_TTL_SECONDS,
    CF_MAX_USER_EVENT_SCORE,
    INTERACTION_LOOKBACK_DAYS,
    POP_MAX_USER_CONTRIBUTION,
)

log = logging.getLogger(__name__)

# Page size for batched loading from PostgREST.  Supabase's default max-rows
# is 1000 — queries without an explicit limit are silently truncated there.
# Paginating in pages of 1000 avoids silent data loss.
_LOAD_PAGE_SIZE = 1000

# ---------------------------------------------------------------------------
# Simple TTL cache for expensive shared queries (interaction matrix, popularity).
# These are global data identical for every request within a time window.
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, object]] = {}  # key -> (expires_at, value)


def _cache_get(key: str) -> object | None:
    """Return cached value if still valid, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        return None
    return value


def _cache_set(key: str, value: object, ttl: int = CACHE_TTL_SECONDS) -> None:
    """Store a value with a TTL."""
    _cache[key] = (time.monotonic() + ttl, value)


# Weights for computing interaction scores.
INTERACTION_WEIGHTS: dict[str, float] = {
    INTERACTION_VIEW: 1.0,
    INTERACTION_CLICK: 2.0,
    INTERACTION_DETAIL_VIEW: 3.0,
    INTERACTION_SAVE: 5.0,
    INTERACTION_UNSAVE: -3.0,
    INTERACTION_SHARE: 3.0,
}


def record_interactions(
    user_id: str | None,
    session_id: str,
    interactions: list[InteractionCreate],
) -> int:
    """Batch-insert interactions. Returns count inserted."""
    if not interactions:
        return 0
    rows = []
    for item in interactions:
        rows.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "session_id": session_id,
            "event_id": item.event_id,
            "interaction_type": item.interaction_type,
            "metadata": item.metadata,
        })
    r = get_sb().table(USER_INTERACTIONS).insert(rows).execute()
    return len(r.data) if r.data else 0


def get_user_event_scores(user_id: str) -> dict[int, float]:
    """Weighted interaction scores for a single user: {event_id: score}.

    Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
    by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
    """
    scores: dict[int, float] = {}
    offset = 0
    while True:
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("event_id, interaction_type")
            .eq("user_id", user_id)
            .order("created_at")
            .range(offset, offset + _LOAD_PAGE_SIZE - 1)
            .execute()
        )
        page = r.data or []
        for row in page:
            eid = row["event_id"]
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            scores[eid] = scores.get(eid, 0) + weight
        if len(page) < _LOAD_PAGE_SIZE:
            break
        offset += _LOAD_PAGE_SIZE
    return scores


def get_interaction_matrix() -> list[InteractionMatrixRow]:
    """
    Return user-event interaction scores as typed rows.
    Used by collaborative filtering to build the user-item matrix.

    Time-windowed to INTERACTION_LOOKBACK_DAYS and cached for CACHE_TTL_SECONDS
    so that concurrent recommendation requests share one DB round-trip.

    Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
    by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
    """
    cached = _cache_get("interaction_matrix")
    if cached is not None:
        return cached  # type: ignore[return-value]

    with _cache_lock:
        # Double-check after acquiring lock
        cached = _cache_get("interaction_matrix")
        if cached is not None:
            return cached  # type: ignore[return-value]

        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=INTERACTION_LOOKBACK_DAYS)
        ).isoformat()

        # Paginate to avoid silent truncation at PostgREST's max-rows limit.
        agg: dict[tuple[str, int], float] = {}
        offset = 0
        while True:
            r = (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, event_id, interaction_type")
                .not_.is_("user_id", "null")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + _LOAD_PAGE_SIZE - 1)
                .execute()
            )
            page = r.data or []
            for row in page:
                key = (row["user_id"], row["event_id"])
                weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
                agg[key] = agg.get(key, 0) + weight
            if len(page) < _LOAD_PAGE_SIZE:
                break
            offset += _LOAD_PAGE_SIZE

        result = [
            InteractionMatrixRow(
                user_id=uid,
                event_id=eid,
                score=min(score, CF_MAX_USER_EVENT_SCORE),
            )
            for (uid, eid), score in agg.items()
            if score > 0
        ]
        _cache_set("interaction_matrix", result)
        return result


def get_event_popularity(limit: int = DEFAULT_INTERACTION_LIMIT) -> list[EventPopularity]:
    """
    Return events ranked by weighted interaction count.
    Returns typed rows sorted descending.

    Time-windowed to INTERACTION_LOOKBACK_DAYS and cached for CACHE_TTL_SECONDS.
    The cache stores the full ranked list; the limit is applied after.

    Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
    by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
    """
    cache_key = "event_popularity"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached[:limit]  # type: ignore[index]

    with _cache_lock:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached[:limit]  # type: ignore[index]

        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=INTERACTION_LOOKBACK_DAYS)
        ).isoformat()

        # Paginate to avoid silent truncation at PostgREST's max-rows limit.
        # Aggregate per (user, event) first so we can cap each user's
        # contribution before summing across users.  This prevents a small
        # number of bot accounts from dominating popularity scores.
        user_event_scores: dict[tuple[str | None, int], float] = {}
        offset = 0
        while True:
            r = (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, event_id, interaction_type")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + _LOAD_PAGE_SIZE - 1)
                .execute()
            )
            page = r.data or []
            for row in page:
                key = (row.get("user_id"), row["event_id"])
                weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
                user_event_scores[key] = user_event_scores.get(key, 0) + weight
            if len(page) < _LOAD_PAGE_SIZE:
                break
            offset += _LOAD_PAGE_SIZE

        # Sum across users with per-user cap applied.
        scores: dict[int, float] = {}
        for (_, eid), raw_score in user_event_scores.items():
            capped = min(raw_score, POP_MAX_USER_CONTRIBUTION)
            scores[eid] = scores.get(eid, 0) + capped

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        result = [EventPopularity(event_id=eid, score=score) for eid, score in ranked]
        _cache_set(cache_key, result)
        return result[:limit]


def get_user_interaction_count(user_id: str) -> int:
    """Count total interactions for a user. Used to determine user 'temperature'."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    return r.count or 0


def get_user_interaction_counts(user_ids: list[str]) -> dict[str, int]:
    """Batch-fetch interaction counts for multiple users.

    Returns {user_id: count} for the given user IDs. Users with zero
    interactions are omitted from the result (callers should use
    ``counts.get(uid, 0)``).

    This avoids N sequential DB round-trips when evaluating many users.
    """
    if not user_ids:
        return {}

    counts: dict[str, int] = {}
    offset = 0
    while True:
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("user_id")
            .in_("user_id", user_ids)
            .order("created_at")
            .range(offset, offset + _LOAD_PAGE_SIZE - 1)
            .execute()
        )
        page = r.data or []
        for row in page:
            uid = row["user_id"]
            counts[uid] = counts.get(uid, 0) + 1
        if len(page) < _LOAD_PAGE_SIZE:
            break
        offset += _LOAD_PAGE_SIZE

    return counts


def check_duplicate_interactions(
    user_id: str,
    interactions: list[InteractionCreate],
) -> list[InteractionCreate]:
    """Filter out interactions that exceed deduplication or global rate thresholds.

    Two limits are enforced within the sliding dedup window:

    1. **Per-(event, type) cap** -- ``MAX_DUPLICATE_INTERACTIONS`` identical
       interactions per event per type.  Prevents hammering the same event.
    2. **Global per-user cap** -- ``MAX_USER_INTERACTIONS_PER_WINDOW`` total
       interactions across all events/types.  Prevents bots from spreading
       interactions across many events to game popularity scores.

    Returns the filtered list.
    """
    if not interactions:
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)).isoformat()

    # Fetch recent interactions for this user within the window
    try:
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("event_id, interaction_type")
            .eq("user_id", user_id)
            .gte("created_at", cutoff)
            .execute()
        )
        existing = r.data or []
    except Exception as e:
        log.warning("Dedup check failed, allowing all interactions: %s", e)
        return interactions

    # Count existing (event_id, type) pairs and total interactions
    counts: dict[tuple[int, str], int] = {}
    total_in_window = len(existing)
    for row in existing:
        key = (row["event_id"], row["interaction_type"])
        counts[key] = counts.get(key, 0) + 1

    filtered: list[InteractionCreate] = []
    for item in interactions:
        # Global per-user cap across all events/types
        if total_in_window >= MAX_USER_INTERACTIONS_PER_WINDOW:
            log.warning(
                "Dropping interaction user=%s event=%s type=%s — global cap reached (%d/%d)",
                user_id, item.event_id, item.interaction_type,
                total_in_window, MAX_USER_INTERACTIONS_PER_WINDOW,
            )
            continue

        # Per-(event, type) cap
        key = (item.event_id, item.interaction_type)
        current = counts.get(key, 0)
        if current >= MAX_DUPLICATE_INTERACTIONS:
            log.warning(
                "Dropping duplicate interaction user=%s event=%s type=%s (count=%d)",
                user_id, item.event_id, item.interaction_type, current,
            )
            continue

        # Track in-batch duplicates and global count
        counts[key] = current + 1
        total_in_window += 1
        filtered.append(item)

    return filtered
