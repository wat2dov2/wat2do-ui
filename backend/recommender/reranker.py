"""MMR diversity ranking with sparse vectors and incremental similarities."""

import logging
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from core.constants import EVENT_CATEGORIES
from schemas.event import EventResponse

log = logging.getLogger(__name__)
from recommender.config import (
    DEFAULT_LAMBDA,
    DEFAULT_LIMIT,
    PRICE_NORMALIZATION_CAP,
    TIME_BUCKET_AFTERNOON_END,
    TIME_BUCKET_MORNING_END,
)

CATEGORY_INDEX = {cat: i for i, cat in enumerate(EVENT_CATEGORIES)}
NUM_CATEGORIES = len(EVENT_CATEGORIES)

TIME_BUCKETS = ("morning", "afternoon", "evening", "weekend")
_TIME_BUCKET_INDEX = {b: i for i, b in enumerate(TIME_BUCKETS)}

# Sparse vectors store only non-zero entries plus a pre-computed magnitude so
# dot-product is O(min(|nz_a|, |nz_b|)) instead of O(dim).


class _SparseVec:
    """Immutable sparse vector with cached magnitude."""

    __slots__ = ("nz", "mag")

    def __init__(self, nz: dict[int, float]):
        self.nz: dict[int, float] = nz
        self.mag: float = math.sqrt(sum(v * v for v in nz.values())) if nz else 0.0


def _sparse_cosine_sim(a: _SparseVec, b: _SparseVec) -> float:
    """Cosine similarity using pre-computed magnitudes and sparse dot product."""
    if a.mag == 0.0 or b.mag == 0.0:
        return 0.0
    if len(a.nz) > len(b.nz):
        a, b = b, a
    dot = 0.0
    b_nz = b.nz
    for idx, val in a.nz.items():
        b_val = b_nz.get(idx)
        if b_val is not None:
            dot += val * b_val
    if dot == 0.0:
        return 0.0
    return dot / (a.mag * b.mag)


def mmr_rerank(
    scored_events: list[tuple[int, float]],
    events_metadata: dict[int, EventResponse],
    lambda_param: float = DEFAULT_LAMBDA,
    k: int = DEFAULT_LIMIT,
    user_timezone: str | None = None,
) -> list[int]:
    """
    Re-rank events using MMR to balance relevance with diversity.

    Args:
        scored_events: [(event_id, relevance_score), ...]
        events_metadata: {event_id: EventResponse}
        lambda_param: 0=pure diversity, 1=pure relevance
        k: number of results to return
        user_timezone: IANA timezone name (e.g. "America/Los_Angeles").
            Used to bucket event start times into morning/afternoon/evening
            in the user's local time.  Defaults to UTC when not provided.

    Returns:
        Ordered list of event_ids.
    """
    if not scored_events:
        return []

    vectors: dict[int, _SparseVec] = {}
    for eid, _ in scored_events:
        meta = events_metadata.get(eid)
        vectors[eid] = _build_sparse_vector(meta, user_timezone=user_timezone)

    score_map = dict(scored_events)
    # dict(scored_events) silently collapses duplicates (last-write-wins);
    # surface this so upstream bugs are visible.
    if len(score_map) != len(scored_events):
        log.warning(
            "mmr_rerank received %d scored events but only %d unique event_ids -- duplicates dropped",
            len(scored_events),
            len(score_map),
        )
    remaining = set(score_map)
    selected: list[int] = []
    max_similarities: dict[int, float] = {}
    neg_lambda = 1.0 - lambda_param

    for _ in range(min(k, len(score_map))):
        best_eid = None
        best_mmr = -float("inf")

        # Resolve ties by relevance and event ID in each remaining candidate set.
        for eid in sorted(remaining, key=lambda eid: (-score_map[eid], eid)):
            relevance = score_map[eid]
            vec_eid = vectors[eid]

            max_sim = max_similarities.get(eid, 0.0)
            if selected:
                sim = _sparse_cosine_sim(vec_eid, vectors[selected[-1]])
                if sim > max_sim:
                    max_similarities[eid] = max_sim = sim

            mmr = lambda_param * relevance - neg_lambda * max_sim

            if mmr > best_mmr:
                best_mmr = mmr
                best_eid = eid

        if best_eid is None:
            break

        selected.append(best_eid)
        remaining.discard(best_eid)

    return selected


def _build_sparse_vector(
    meta: EventResponse | None,
    *,
    user_timezone: str | None = None,
) -> _SparseVec:
    """Encode category, normalized price, and local-time bucket as sparse features."""
    if meta is None:
        return _SparseVec({})

    nz: dict[int, float] = {}

    cat = meta.category or ""
    idx = CATEGORY_INDEX.get(cat)
    if idx is not None:
        nz[idx] = 1.0

    price = meta.price or 0
    if price:
        nz[NUM_CATEGORIES] = min(price / PRICE_NORMALIZATION_CAP, 1.0)

    dtstart = None
    if meta.occurrences:
        now_utc = datetime.now(timezone.utc)
        future_occs = [
            o
            for o in meta.occurrences
            if (
                o.dtstart_utc
                if o.dtstart_utc.tzinfo
                else o.dtstart_utc.replace(tzinfo=timezone.utc)
            )
            >= now_utc
        ]
        pool = future_occs or list(meta.occurrences)
        pool.sort(key=lambda o: o.dtstart_utc)
        dtstart = pool[0].dtstart_utc

    dtstart_str = dtstart.isoformat() if dtstart else ""
    bucket = _get_time_bucket(dtstart_str, user_timezone=user_timezone)
    bucket_idx = _TIME_BUCKET_INDEX.get(bucket)
    if bucket_idx is not None:
        nz[NUM_CATEGORIES + 1 + bucket_idx] = 1.0

    return _SparseVec(nz)


def _get_time_bucket(dtstart: str, *, user_timezone: str | None = None) -> str:
    """Determine time bucket from ISO datetime string.

    When *user_timezone* is supplied (IANA name) the event start is converted
    to the user's local time before bucketing so 8 AM PST events land in
    "morning" for PST users instead of "afternoon" (16:00 UTC).
    Falls back to UTC when no timezone is provided or the timezone is invalid.
    """
    if not dtstart:
        return "afternoon"
    try:
        dt = datetime.fromisoformat(dtstart.replace("Z", "+00:00"))
        if user_timezone:
            try:
                tz = ZoneInfo(user_timezone)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                dt = dt.astimezone(tz)
            except ZoneInfoNotFoundError:
                log.warning(
                    "Unknown user_timezone %r, bucketing in UTC",
                    user_timezone,
                )
        if dt.weekday() >= 5:
            return "weekend"
        hour = dt.hour
        if hour < TIME_BUCKET_MORNING_END:
            return "morning"
        elif hour < TIME_BUCKET_AFTERNOON_END:
            return "afternoon"
        else:
            return "evening"
    except (ValueError, TypeError) as e:
        log.warning("Failed to parse time_of_day from %s: %s", dtstart, e)
        return "afternoon"
