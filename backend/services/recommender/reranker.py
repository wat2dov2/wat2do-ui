"""MMR (Maximal Marginal Relevance) re-ranker for diversity."""

import math

from constants import EVENT_CATEGORIES
from schemas.event import EventResponse


# One-hot dimension for categories.
CATEGORY_INDEX = {cat: i for i, cat in enumerate(EVENT_CATEGORIES)}
NUM_CATEGORIES = len(EVENT_CATEGORIES)

# Time buckets for diversity.
TIME_BUCKETS = ("morning", "afternoon", "evening", "weekend")


def mmr_rerank(
    scored_events: list[tuple[int, float]],
    events_metadata: dict[int, EventResponse],
    lambda_param: float = 0.7,
    k: int = 20,
) -> list[int]:
    """
    Re-rank events using MMR to balance relevance with diversity.

    Args:
        scored_events: [(event_id, relevance_score), ...]
        events_metadata: {event_id: EventResponse}
        lambda_param: 0=pure diversity, 1=pure relevance
        k: number of results to return

    Returns:
        Ordered list of event_ids.
    """
    if not scored_events:
        return []

    vectors: dict[int, list[float]] = {}
    for eid, _ in scored_events:
        meta = events_metadata.get(eid)
        vectors[eid] = _build_feature_vector(meta)

    score_map = dict(scored_events)
    remaining = set(score_map.keys())
    selected: list[int] = []

    for _ in range(min(k, len(scored_events))):
        best_eid = None
        best_mmr = -float("inf")

        for eid in remaining:
            relevance = score_map[eid]

            # Max similarity to already selected items
            max_sim = 0.0
            for sel_eid in selected:
                sim = _cosine_sim(vectors[eid], vectors[sel_eid])
                if sim > max_sim:
                    max_sim = sim

            mmr = lambda_param * relevance - (1 - lambda_param) * max_sim

            if mmr > best_mmr:
                best_mmr = mmr
                best_eid = eid

        if best_eid is None:
            break

        selected.append(best_eid)
        remaining.remove(best_eid)

    return selected


def _build_feature_vector(meta: EventResponse | None) -> list[float]:
    """
    Build a feature vector for diversity measurement:
    - One-hot category (22 dims)
    - Normalized price (1 dim)
    - Time bucket (4 dims: morning/afternoon/evening/weekend)
    Total: 27 dimensions.
    """
    vec = [0.0] * (NUM_CATEGORIES + 1 + len(TIME_BUCKETS))

    if meta is None:
        return vec

    # Category one-hot
    cat = meta.category or ""
    idx = CATEGORY_INDEX.get(cat)
    if idx is not None:
        vec[idx] = 1.0

    # Normalized price (0 = free, 1 = expensive)
    price = meta.price or 0
    vec[NUM_CATEGORIES] = min(price / 50.0, 1.0) if price else 0.0

    # Time bucket
    dtstart = meta.dtstart_utc
    dtstart_str = dtstart.isoformat() if dtstart else ""
    bucket = _get_time_bucket(dtstart_str)
    if bucket in TIME_BUCKETS:
        bucket_idx = TIME_BUCKETS.index(bucket)
        vec[NUM_CATEGORIES + 1 + bucket_idx] = 1.0

    return vec


def _get_time_bucket(dtstart: str) -> str:
    """Determine time bucket from ISO datetime string."""
    if not dtstart:
        return "afternoon"
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(dtstart.replace("Z", "+00:00"))
        if dt.weekday() >= 5:
            return "weekend"
        hour = dt.hour
        if hour < 12:
            return "morning"
        elif hour < 17:
            return "afternoon"
        else:
            return "evening"
    except (ValueError, TypeError):
        return "afternoon"


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two dense vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
