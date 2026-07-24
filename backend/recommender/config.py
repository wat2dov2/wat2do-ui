"""Recommendation constants projected from the validated feature control box."""

from core.controlbox import ScoreBlend, controlbox

_CONTROL = controlbox.recommendations
_PERSONALIZATION = _CONTROL.personalization
_COLLABORATIVE = _CONTROL.collaborative_filtering
_CONTENT = _CONTROL.content_scoring
_POPULARITY = _CONTROL.popularity
_INTERACTIONS = _CONTROL.interactions
_EVALUATION = _CONTROL.evaluation

DEFAULT_LIMIT = _CONTROL.snapshot.recommendations_per_user
MAX_LIMIT = _CONTROL.api.maximum_results
CANDIDATE_POOL_SIZE = _CONTROL.snapshot.candidate_events_per_school

DEFAULT_LAMBDA = _PERSONALIZATION.relevance_weight

HOT_THRESHOLD = _PERSONALIZATION.hot_interactions
WARM_THRESHOLD = _PERSONALIZATION.warm_interactions


def _blend_tuple(blend: ScoreBlend) -> tuple[float, float, float]:
    return (blend.content, blend.collaborative, blend.popularity)


WEIGHTS_HOT = _blend_tuple(_PERSONALIZATION.hot_blend)
WEIGHTS_WARM = _blend_tuple(_PERSONALIZATION.warm_blend)
WEIGHTS_WARM_NO_COLLAB = _blend_tuple(_PERSONALIZATION.warm_without_collaborative_blend)
WEIGHTS_COLD = _blend_tuple(_PERSONALIZATION.cold_blend)

CF_MIN_INTERACTIONS = _COLLABORATIVE.minimum_interactions
CF_NEIGHBOR_K = _COLLABORATIVE.neighbor_count
CF_BLEND_WEIGHT = _COLLABORATIVE.user_item_blend_weight
CF_GOING_WEIGHT = _COLLABORATIVE.going_weight

CB_CATEGORY_MATCH = _CONTENT.category_match
CB_CATEGORY_NO_PROFILE = _CONTENT.category_without_profile
CB_SCHOOL_MATCH = _CONTENT.school_match
CB_ORG_AFFINITY = _CONTENT.organization_affinity
CB_TEMPORAL_TIERS = tuple((tier.within_hours, tier.score) for tier in _CONTENT.temporal_tiers)
CB_TEMPORAL_FALLBACK = _CONTENT.temporal_fallback
CB_FREE_EVENT = _CONTENT.free_event
CB_HAS_FOOD = _CONTENT.has_food
CB_FIRST_YEAR = _CONTENT.first_year

FIRST_YEAR_CATEGORIES = _CONTENT.first_year_categories

PRICE_NORMALIZATION_CAP = _CONTENT.price_normalization_cap

TIME_BUCKET_MORNING_END = _CONTENT.morning_end_hour
TIME_BUCKET_AFTERNOON_END = _CONTENT.afternoon_end_hour

POP_HALF_LIFE_DAYS = _POPULARITY.half_life_days
POP_FALLBACK_SCORE = _POPULARITY.fallback_score
POP_CANDIDATE_LIMIT = _POPULARITY.candidate_limit

# Cap on the weighted score any single user can contribute to a single event's
# popularity.  Without this, a bot account spamming all interaction types at the
# dedup limit dominates the popularity ranking.  The cap is applied before
# aggregation across users, so an event's popularity reflects breadth of
# interest (many users) rather than depth from a few heavy users.
POP_MAX_USER_CONTRIBUTION = _POPULARITY.maximum_user_contribution

# Same idea for the collaborative-filtering interaction matrix.  Each (user,
# event) score is clamped so that inflated interaction counts don't distort
# cosine-similarity neighbourhoods.
CF_MAX_USER_EVENT_SCORE = _COLLABORATIVE.maximum_user_event_score

INTERACTION_LOOKBACK_DAYS = _INTERACTIONS.lookback_days

# Weights for computing per-user event scores from raw interaction types.
# Used by interaction_service for user-event scoring, the collaborative
# filtering matrix, and popularity aggregation.
from core.constants import INTERACTION_TYPES

INTERACTION_WEIGHTS: dict[str, float] = dict(_INTERACTIONS.weights)

assert set(INTERACTION_WEIGHTS.keys()) == set(INTERACTION_TYPES), (
    f"INTERACTION_WEIGHTS keys {set(INTERACTION_WEIGHTS.keys())} != INTERACTION_TYPES {set(INTERACTION_TYPES)}"
)

EVAL_K = _EVALUATION.k
EVAL_MIN_INTERACTIONS = _EVALUATION.minimum_interactions
EVAL_MAX_EVENTS = _EVALUATION.maximum_events
