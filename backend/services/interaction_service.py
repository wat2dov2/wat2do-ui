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
from core.pagination import iter_all_pages
from core.tables import USER_INTERACTIONS
from schemas.interaction import InteractionCreate, InteractionMatrixRow, EventPopularity
from cachetools import TTLCache
from services.recommender.config import (
    CACHE_TTL_SECONDS,
    CF_MAX_USER_EVENT_SCORE,
    INTERACTION_LOOKBACK_DAYS,
    POP_MAX_USER_CONTRIBUTION,
    USER_SCORES_CACHE_MAX,
    USER_SCORES_CACHE_TTL,
)

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


# ---------------------------------------------------------------------------
# Per-user TTL cache for get_user_event_scores.
# Uses cachetools.TTLCache (same library as user_service) for automatic
# per-entry expiry and LRU eviction at max size.  Protected by a lock so
# that concurrent requests for the same user don't trigger parallel DB
# fetches (double-check pattern consistent with the global caches above).
# ---------------------------------------------------------------------------
_user_scores_lock = threading.Lock()
_user_scores_cache: TTLCache[str, dict[int, float]] = TTLCache(
    maxsize=USER_SCORES_CACHE_MAX, ttl=USER_SCORES_CACHE_TTL,
)


def clear_user_scores_cache(user_id: str | None = None) -> None:
    """Invalidate cached user event scores.

    Args:
        user_id: Clear scores for a specific user.  If None, clear all.
    """
    with _user_scores_lock:
        if user_id is None:
            _user_scores_cache.clear()
        else:
            _user_scores_cache.pop(user_id, None)


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

    Results are cached per-user for USER_SCORES_CACHE_TTL seconds to avoid
    hitting the database on every recommendation request.  Thread-safe via
    double-check locking so concurrent requests share one DB round-trip.
    """
    # Fast path: check without lock
    cached = _user_scores_cache.get(user_id)
    if cached is not None:
        log.debug("User event scores cache HIT for user %s", user_id)
        return cached

    with _user_scores_lock:
        # Double-check after acquiring lock
        cached = _user_scores_cache.get(user_id)
        if cached is not None:
            log.debug("User event scores cache HIT (after lock) for user %s", user_id)
            return cached

        log.debug("User event scores cache MISS for user %s — querying DB", user_id)
        scores: dict[int, float] = {}
        for row in iter_all_pages(
            lambda offset, ps: (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("event_id, interaction_type")
                .eq("user_id", user_id)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data or [],
        ):
            eid = row["event_id"]
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            scores[eid] = scores.get(eid, 0) + weight

        _user_scores_cache[user_id] = scores
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

        agg: dict[tuple[str, int], float] = {}
        for row in iter_all_pages(
            lambda offset, ps: (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, event_id, interaction_type")
                .not_.is_("user_id", "null")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data or [],
        ):
            key = (row["user_id"], row["event_id"])
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            agg[key] = agg.get(key, 0) + weight

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

        # Aggregate per (user, event) first so we can cap each user's
        # contribution before summing across users.  This prevents a small
        # number of bot accounts from dominating popularity scores.
        user_event_scores: dict[tuple[str | None, int], float] = {}
        for row in iter_all_pages(
            lambda offset, ps: (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, event_id, interaction_type")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data or [],
        ):
            key = (row.get("user_id"), row["event_id"])
            weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
            user_event_scores[key] = user_event_scores.get(key, 0) + weight

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
    for row in iter_all_pages(
        lambda offset, ps: (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("user_id")
            .in_("user_id", user_ids)
            .order("created_at")
            .range(offset, offset + ps - 1)
            .execute()
        ).data or [],
    ):
        uid = row["user_id"]
        counts[uid] = counts.get(uid, 0) + 1

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
        log.error("Dedup check failed, rejecting batch to prevent gaming: %s", e)
        return []

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
