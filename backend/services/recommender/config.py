"""Centralised defaults for the recommendation pipeline.

Every tunable knob lives here so that recommendation_service, evaluation,
reranker, collaborative, the nightly job, and the API router all draw from
one source of truth.
"""

# ---------------------------------------------------------------------------
# Result limits
# ---------------------------------------------------------------------------
DEFAULT_LIMIT: int = 20          # max recommendations returned per request
MAX_LIMIT: int = 50              # upper bound enforced by the API
CANDIDATE_POOL_SIZE: int = 200   # future events loaded as candidates

# ---------------------------------------------------------------------------
# MMR diversity / relevance trade-off
# ---------------------------------------------------------------------------
DEFAULT_LAMBDA: float = 0.7      # 0 = pure diversity, 1 = pure relevance

# ---------------------------------------------------------------------------
# User temperature thresholds (interaction counts)
# ---------------------------------------------------------------------------
HOT_THRESHOLD: int = 10          # >= hot  -> heavy collaborative signal
WARM_THRESHOLD: int = 3          # >= warm -> some collaborative signal

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
CF_MIN_INTERACTIONS: int = 3     # cold-start guard
CF_NEIGHBOR_K: int = 20          # k-nearest neighbours for user-based CF
CF_BLEND_WEIGHT: float = 0.5     # user-based vs item-based 50/50
CF_SAVE_WEIGHT: float = 5.0      # weight for a "save" in the CF matrix

# ---------------------------------------------------------------------------
# Content-based scoring weights (must sum to ~1.0)
# ---------------------------------------------------------------------------
CB_CATEGORY_MATCH: float = 0.4        # category matches user interests
CB_CATEGORY_NO_PROFILE: float = 0.2   # fallback when user has no interests
CB_SCHOOL_MATCH: float = 0.15         # same school as user
CB_ORG_AFFINITY: float = 0.15         # user has history with this org
CB_TEMPORAL_WEIGHT: float = 0.15      # base temporal relevance weight
CB_TEMPORAL_TIERS: tuple[tuple[int, float], ...] = (
    (24, 0.15),    # < 24h away
    (72, 0.12),    # < 3 days away
    (168, 0.08),   # < 1 week away
)
CB_TEMPORAL_FALLBACK: float = 0.04    # > 1 week away or parse error
CB_FREE_EVENT: float = 0.05           # free events get a slight boost
CB_HAS_FOOD: float = 0.05             # events with food
CB_FIRST_YEAR: float = 0.05           # first-year student boost

FIRST_YEAR_CATEGORIES: frozenset[str] = frozenset({
    "Academics", "Networking", "Culture", "Sports",
})

# ---------------------------------------------------------------------------
# Popularity scoring
# ---------------------------------------------------------------------------
POP_HALF_LIFE_DAYS: float = 7.0       # exponential decay half-life
POP_FALLBACK_SCORE: float = 0.1       # base score for events with 0 interactions
POP_CANDIDATE_LIMIT: int = 500        # max events fetched for popularity scoring

# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
EVAL_K: int = 10                 # default K for precision/NDCG
EVAL_MIN_INTERACTIONS: int = 5   # min interactions to be eligible
