"""Scoring helpers: weight selection and score blending.

These are business logic functions that belong in the recommender package
but not in the inert config module.  Both recommendation_service and
evaluation import from here.
"""

from services.recommender.config import (
    HOT_THRESHOLD,
    WARM_THRESHOLD,
    WEIGHTS_COLD,
    WEIGHTS_HOT,
    WEIGHTS_WARM,
    WEIGHTS_WARM_NO_COLLAB,
)

# ---------------------------------------------------------------------------
# Temperature-tier table for select_weights.
# Each entry is (predicate, weights) evaluated in order; the first matching
# predicate wins.  Adding a new tier requires only a new row here — the
# function body never changes (Open/Closed).
# ---------------------------------------------------------------------------
_TEMP_TIERS: list[tuple] = [
    # (predicate(interaction_count, has_profile), weights)
    (lambda count, profile, hot, warm: count >= hot, WEIGHTS_HOT),
    (lambda count, profile, hot, warm: count >= warm, WEIGHTS_WARM),
    (lambda count, profile, hot, warm: profile, WEIGHTS_WARM_NO_COLLAB),
]
_TEMP_DEFAULT = WEIGHTS_COLD


def select_weights(
    interaction_count: int,
    has_profile: bool,
    hot_threshold: int = HOT_THRESHOLD,
    warm_threshold: int = WARM_THRESHOLD,
) -> tuple[float, float, float]:
    """Choose blend weights based on user temperature (interaction count + profile).

    Returns (w_content, w_collab, w_pop).
    """
    for predicate, weights in _TEMP_TIERS:
        if predicate(interaction_count, has_profile, hot_threshold, warm_threshold):
            return weights
    return _TEMP_DEFAULT


def blend_scores(
    candidate_ids: list[int],
    content_scores: dict[int, float],
    collab_scores: dict[int, float],
    pop_scores: dict[int, float],
    weights: tuple[float, float, float],
    *,
    exclude: set[int] | None = None,
) -> dict[int, float]:
    """Compute weighted blend of content, collaborative, and popularity scores.

    Returns {event_id: blended_score} for the given candidates.
    Events in *exclude* are skipped.

    When a scorer dict is empty, the corresponding weight is redistributed
    across the remaining non-empty scorers (proportional renormalization) so
    that a failed or skipped scorer does not scale the final score down.
    (R9)

    Zero-scored items are retained in the blend as long as at least one
    scorer produced data; only when all scorers are empty do we drop items.
    This preserves candidates with zero preference signal rather than
    silently collapsing the blend. (R10)
    """
    w_content, w_collab, w_pop = weights
    skip = exclude or set()

    # R9: renormalize weights across scorers that actually produced data.
    scorer_present = (
        bool(content_scores),
        bool(collab_scores),
        bool(pop_scores),
    )
    effective_weights = [
        w_content if scorer_present[0] else 0.0,
        w_collab if scorer_present[1] else 0.0,
        w_pop if scorer_present[2] else 0.0,
    ]
    total_weight = sum(effective_weights)
    if total_weight > 0:
        w_content, w_collab, w_pop = (w / total_weight for w in effective_weights)
    else:
        w_content, w_collab, w_pop = 0.0, 0.0, 0.0

    any_scorer_present = any(scorer_present)

    blended: dict[int, float] = {}
    for eid in candidate_ids:
        if eid in skip:
            continue
        score = (
            w_content * content_scores.get(eid, 0)
            + w_collab * collab_scores.get(eid, 0)
            + w_pop * pop_scores.get(eid, 0)
        )
        # R10: keep zero-scored items when any scorer produced data so the
        # blend doesn't silently go empty (which triggers a fallback path).
        if score > 0 or any_scorer_present:
            blended[eid] = score
    return blended
