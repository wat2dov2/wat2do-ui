"""Centralised defaults for the recommendation pipeline.

Every tunable knob lives here so that recommendation_service, evaluation,
reranker, collaborative, the nightly job, and the API router all draw from
one source of truth.
"""

# ---------------------------------------------------------------------------
# Result limits
# ---------------------------------------------------------------------------
DEFAULT_LIMIT: int = 20  # max recommendations returned per request
MAX_LIMIT: int = 50  # upper bound enforced by the API
CANDIDATE_POOL_SIZE: int = 200  # future events loaded as candidates

# ---------------------------------------------------------------------------
# MMR diversity / relevance trade-off
# ---------------------------------------------------------------------------
DEFAULT_LAMBDA: float = 0.7  # 0 = pure diversity, 1 = pure relevance

# ---------------------------------------------------------------------------
# User temperature thresholds (interaction counts)
# ---------------------------------------------------------------------------
HOT_THRESHOLD: int = 10  # >= hot  -> heavy collaborative signal
WARM_THRESHOLD: int = 3  # >= warm -> some collaborative signal

# ---------------------------------------------------------------------------
# Blend weights per temperature  (content, collaborative, popularity)
# ---------------------------------------------------------------------------
WEIGHTS_HOT: tuple[float, float, float] = (0.3, 0.5, 0.2)
WEIGHTS_WARM: tuple[float, float, float] = (0.5, 0.2, 0.3)
WEIGHTS_WARM_NO_COLLAB: tuple[float, float, float] = (0.7, 0.0, 0.3)
WEIGHTS_COLD: tuple[float, float, float] = (0.0, 0.0, 1.0)

# ---------------------------------------------------------------------------
# Collaborative filtering
# ---------------------------------------------------------------------------
CF_MIN_INTERACTIONS: int = 3  # cold-start guard
CF_NEIGHBOR_K: int = 20  # k-nearest neighbours for user-based CF
CF_BLEND_WEIGHT: float = 0.5  # user-based vs item-based 50/50
CF_SAVE_WEIGHT: float = 5.0  # weight for a "save" in the CF matrix

# ---------------------------------------------------------------------------
# Content-based scoring weights (must sum to ~1.0)
# ---------------------------------------------------------------------------
CB_CATEGORY_MATCH: float = 0.4  # category matches user interests
CB_CATEGORY_NO_PROFILE: float = 0.2  # fallback when user has no interests
CB_SCHOOL_MATCH: float = 0.15  # same school as user
CB_ORG_AFFINITY: float = 0.15  # user has history with this org
CB_TEMPORAL_TIERS: tuple[tuple[int, float], ...] = (
    (24, 0.15),  # < 24h away
    (72, 0.12),  # < 3 days away
    (168, 0.08),  # < 1 week away
)
CB_TEMPORAL_FALLBACK: float = 0.04  # > 1 week away or parse error
CB_FREE_EVENT: float = 0.05  # free events get a slight boost
CB_HAS_FOOD: float = 0.05  # events with food
CB_FIRST_YEAR: float = 0.05  # first-year student boost

FIRST_YEAR_CATEGORIES: frozenset[str] = frozenset(
    {
        "Academics",
        "Networking",
        "Culture",
        "Sports",
    }
)

# ---------------------------------------------------------------------------
# Reranker: price normalization
# ---------------------------------------------------------------------------
PRICE_NORMALIZATION_CAP: float = 50.0  # prices >= this map to 1.0 in the feature vector

# ---------------------------------------------------------------------------
# Reranker: time-bucket hour boundaries
# ---------------------------------------------------------------------------
TIME_BUCKET_MORNING_END: int = 12  # hours [0, 12) = morning
TIME_BUCKET_AFTERNOON_END: int = 17  # hours [12, 17) = afternoon; >= 17 = evening

# ---------------------------------------------------------------------------
# Popularity scoring
# ---------------------------------------------------------------------------
POP_HALF_LIFE_DAYS: float = 7.0  # exponential decay half-life
POP_FALLBACK_SCORE: float = 0.1  # base score for events with 0 interactions
POP_CANDIDATE_LIMIT: int = 500  # max events fetched for popularity scoring

# ---------------------------------------------------------------------------
# Anti-gaming: per-user score dampening
# ---------------------------------------------------------------------------
# Cap on the weighted score any single user can contribute to a single event's
# popularity.  Without this, a bot account spamming all interaction types at the
# dedup limit dominates the popularity ranking.  The cap is applied before
# aggregation across users, so an event's popularity reflects breadth of
# interest (many users) rather than depth from a few heavy users.
POP_MAX_USER_CONTRIBUTION: float = 15.0

# Same idea for the collaborative-filtering interaction matrix.  Each (user,
# event) score is clamped so that inflated interaction counts don't distort
# cosine-similarity neighbourhoods.
CF_MAX_USER_EVENT_SCORE: float = 15.0

# ---------------------------------------------------------------------------
# Caching & time-windowing for recommendation queries
# ---------------------------------------------------------------------------
INTERACTION_LOOKBACK_DAYS: int = 90  # only use interactions from the last N days
CACHE_TTL_SECONDS: int = 1800  # 30-minute TTL for shared recommendation data

# Per-user interaction scores: shorter TTL because scores change when the user
# interacts, and the cache is per-user (memory scales with active users).
USER_SCORES_CACHE_TTL: int = 300  # 5-minute TTL for per-user event scores

# P5: bound the per-user score cache with LRU eviction so memory stays
# proportional to the *most recently active* users rather than every user
# who ever hit recommendations.  Tune upward if the active cohort is larger.
USER_SCORES_CACHE_MAX: int = 512  # max users cached simultaneously

# Candidate events (future events query): identical for all users within a
# time window, so a short global TTL avoids redundant DB hits during batch
# processing without serving stale data for long.
CANDIDATE_EVENTS_CACHE_TTL: int = 60  # 1-minute TTL for candidate events

# ---------------------------------------------------------------------------
# Interaction scoring weights
# ---------------------------------------------------------------------------
# Weights for computing per-user event scores from raw interaction types.
# Used by interaction_service for user-event scoring, the collaborative
# filtering matrix, and popularity aggregation.
from core.constants import (
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_SAVE,
    INTERACTION_SHARE,
    INTERACTION_TYPES,
    INTERACTION_UNSAVE,
    INTERACTION_VIEW,
)

INTERACTION_WEIGHTS: dict[str, float] = {
    INTERACTION_VIEW: 1.0,
    INTERACTION_CLICK: 2.0,
    INTERACTION_DETAIL_VIEW: 3.0,
    INTERACTION_SAVE: 5.0,
    INTERACTION_UNSAVE: -3.0,
    INTERACTION_SHARE: 3.0,
}

assert set(INTERACTION_WEIGHTS.keys()) == set(INTERACTION_TYPES), (
    f"INTERACTION_WEIGHTS keys {set(INTERACTION_WEIGHTS.keys())} != INTERACTION_TYPES {set(INTERACTION_TYPES)}"
)

# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
EVAL_K: int = 10  # default K for precision/NDCG
EVAL_MIN_INTERACTIONS: int = 5  # min interactions to be eligible
EVAL_MAX_EVENTS: int = 2000  # cap on events loaded for offline eval (0 = no limit)
