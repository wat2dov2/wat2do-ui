"""MMR (Maximal Marginal Relevance) re-ranker for diversity.

Performance notes
-----------------
The MMR loop is O(k * m) cosine-similarity computations where k = items
returned and m = candidate pool size.  Two optimisations keep this fast in
pure Python:

1. **Pre-computed magnitudes** -- each vector's L2 norm is computed once
   rather than re-derived on every similarity call.  This removes ~2/3 of
   the per-call floating-point work.

2. **Sparse dot product** -- because vectors are mostly zero (one-hot
   category + one-hot time bucket + one price float), we store the indices
   of non-zero entries and iterate only over those when computing dot
   products and magnitudes.  For the typical 27-dim vector with 2-3
   non-zero entries this turns an O(27) inner loop into O(2-3).
"""

import math
from datetime import datetime

from constants import EVENT_CATEGORIES
from schemas.event import EventResponse
from services.recommender.config import (
    DEFAULT_LAMBDA,
    DEFAULT_LIMIT,
    PRICE_NORMALIZATION_CAP,
    TIME_BUCKET_MORNING_END,
    TIME_BUCKET_AFTERNOON_END,
)


# One-hot dimension for categories.
CATEGORY_INDEX = {cat: i for i, cat in enumerate(EVENT_CATEGORIES)}
NUM_CATEGORIES = len(EVENT_CATEGORIES)

# Time buckets for diversity.
TIME_BUCKETS = ("morning", "afternoon", "evening", "weekend")
_TIME_BUCKET_INDEX = {b: i for i, b in enumerate(TIME_BUCKETS)}

# Total feature-vector dimensionality (for reference; not used at runtime).
_VECTOR_DIM = NUM_CATEGORIES + 1 + len(TIME_BUCKETS)  # 27


# ---------------------------------------------------------------------------
# Sparse vector representation
# ---------------------------------------------------------------------------
# Instead of a dense list[float] we store only the non-zero entries and the
# pre-computed magnitude.  This makes dot-product O(min(|nz_a|, |nz_b|))
# instead of O(dim) and eliminates redundant magnitude calculations.

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
    # Iterate over the smaller set for minimal work.
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def mmr_rerank(
    scored_events: list[tuple[int, float]],
    events_metadata: dict[int, EventResponse],
    lambda_param: float = DEFAULT_LAMBDA,
    k: int = DEFAULT_LIMIT,
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

    vectors: dict[int, _SparseVec] = {}
    for eid, _ in scored_events:
        meta = events_metadata.get(eid)
        vectors[eid] = _build_sparse_vector(meta)

    score_map = dict(scored_events)
    remaining = set(score_map.keys())
    selected: list[int] = []
    neg_lambda = 1.0 - lambda_param

    for _ in range(min(k, len(scored_events))):
        best_eid = None
        best_mmr = -float("inf")

        for eid in remaining:
            relevance = score_map[eid]
            vec_eid = vectors[eid]

            # Max similarity to already selected items
            max_sim = 0.0
            for sel_eid in selected:
                sim = _sparse_cosine_sim(vec_eid, vectors[sel_eid])
                if sim > max_sim:
                    max_sim = sim

            mmr = lambda_param * relevance - neg_lambda * max_sim

            if mmr > best_mmr:
                best_mmr = mmr
                best_eid = eid

        if best_eid is None:
            break

        selected.append(best_eid)
        remaining.discard(best_eid)

    return selected


# ---------------------------------------------------------------------------
# Feature vector construction (sparse)
# ---------------------------------------------------------------------------

def _build_sparse_vector(meta: EventResponse | None) -> _SparseVec:
    """
    Build a sparse feature vector for diversity measurement.

    Dimensions (27 total):
    - [0..21]  one-hot category (22 dims)
    - [22]     normalized price (1 dim)
    - [23..26] time bucket one-hot (4 dims: morning/afternoon/evening/weekend)
    """
    if meta is None:
        return _SparseVec({})

    nz: dict[int, float] = {}

    # Category one-hot
    cat = meta.category or ""
    idx = CATEGORY_INDEX.get(cat)
    if idx is not None:
        nz[idx] = 1.0

    # Normalized price (0 = free, 1 = expensive)
    price = meta.price or 0
    if price:
        nz[NUM_CATEGORIES] = min(price / PRICE_NORMALIZATION_CAP, 1.0)

    # Time bucket
    dtstart = meta.dtstart_utc
    dtstart_str = dtstart.isoformat() if dtstart else ""
    bucket = _get_time_bucket(dtstart_str)
    bucket_idx = _TIME_BUCKET_INDEX.get(bucket)
    if bucket_idx is not None:
        nz[NUM_CATEGORIES + 1 + bucket_idx] = 1.0

    return _SparseVec(nz)


def _get_time_bucket(dtstart: str) -> str:
    """Determine time bucket from ISO datetime string."""
    if not dtstart:
        return "afternoon"
    try:
        dt = datetime.fromisoformat(dtstart.replace("Z", "+00:00"))
        if dt.weekday() >= 5:
            return "weekend"
        hour = dt.hour
        if hour < TIME_BUCKET_MORNING_END:
            return "morning"
        elif hour < TIME_BUCKET_AFTERNOON_END:
            return "afternoon"
        else:
            return "evening"
    except (ValueError, TypeError):
        return "afternoon"


# ---------------------------------------------------------------------------
# Backwards-compatible dense helpers (kept for any external callers / tests)
# ---------------------------------------------------------------------------

def _build_feature_vector(meta: EventResponse | None) -> list[float]:
    """Dense feature vector -- retained for test compatibility."""
    vec = [0.0] * _VECTOR_DIM
    sv = _build_sparse_vector(meta)
    for idx, val in sv.nz.items():
        vec[idx] = val
    return vec


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two dense vectors (legacy helper)."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
