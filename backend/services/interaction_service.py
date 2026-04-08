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
)
from core.database import get_sb
from core.tables import USER_INTERACTIONS
from schemas.interaction import InteractionCreate, InteractionMatrixRow, EventPopularity
from services.recommender.config import INTERACTION_LOOKBACK_DAYS, CACHE_TTL_SECONDS

log = logging.getLogger(__name__)

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
    """Weighted interaction scores for a single user: {event_id: score}."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("event_id, interaction_type")
        .eq("user_id", user_id)
        .execute()
    )
    scores: dict[int, float] = {}
    for row in r.data or []:
        eid = row["event_id"]
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        scores[eid] = scores.get(eid, 0) + weight
    return scores


def get_interaction_matrix() -> list[InteractionMatrixRow]:
    """
    Return user-event interaction scores as typed rows.
    Used by collaborative filtering to build the user-item matrix.

    Time-windowed to INTERACTION_LOOKBACK_DAYS and cached for CACHE_TTL_SECONDS
    so that concurrent recommendation requests share one DB round-trip.
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
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("user_id, event_id, interaction_type")
            .not_.is_("user_id", "null")
            .gte("created_at", cutoff)
            .execute()
        )
        # Aggregate per (user, event)
        agg: dict[tuple[str, int], float] = {}
        for row in r.data or []:
            key = (row["user_id"], row["event_id"])
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            agg[key] = agg.get(key, 0) + weight
        result = [
            InteractionMatrixRow(user_id=uid, event_id=eid, score=score)
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
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("event_id, interaction_type")
            .gte("created_at", cutoff)
            .execute()
        )
        scores: dict[int, float] = {}
        for row in r.data or []:
            eid = row["event_id"]
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            scores[eid] = scores.get(eid, 0) + weight

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


def check_duplicate_interactions(
    user_id: str,
    interactions: list[InteractionCreate],
) -> list[InteractionCreate]:
    """Filter out interactions that exceed the deduplication threshold.

    For each (event_id, interaction_type) pair in *interactions*, count how
    many matching rows the user already has within the dedup window.  If the
    count is already at or above ``MAX_DUPLICATE_INTERACTIONS``, drop that
    interaction from the batch.  Returns the filtered list.
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

    # Count existing (event_id, type) pairs
    counts: dict[tuple[int, str], int] = {}
    for row in existing:
        key = (row["event_id"], row["interaction_type"])
        counts[key] = counts.get(key, 0) + 1

    filtered: list[InteractionCreate] = []
    for item in interactions:
        key = (item.event_id, item.interaction_type)
        current = counts.get(key, 0)
        if current >= MAX_DUPLICATE_INTERACTIONS:
            log.warning(
                "Dropping duplicate interaction user=%s event=%s type=%s (count=%d)",
                user_id, item.event_id, item.interaction_type, current,
            )
            continue
        # Track in-batch duplicates too
        counts[key] = current + 1
        filtered.append(item)

    return filtered
