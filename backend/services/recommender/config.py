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

# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
EVAL_K: int = 10                 # default K for precision/NDCG
EVAL_MIN_INTERACTIONS: int = 5   # min interactions to be eligible
