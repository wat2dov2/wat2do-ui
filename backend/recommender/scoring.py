"""Scoring helpers: weight selection and score blending.

These are business logic functions that belong in the recommender package
but not in the inert config module.  Both recommendation_service and
evaluation import from here.
"""

from recommender.config import (
    HOT_THRESHOLD,
    WARM_THRESHOLD,
    WEIGHTS_COLD,
    WEIGHTS_HOT,
    WEIGHTS_WARM,
    WEIGHTS_WARM_NO_COLLAB,
)


def select_weights(
    interaction_count: int,
    has_profile: bool,
    hot_threshold: int = HOT_THRESHOLD,
    warm_threshold: int = WARM_THRESHOLD,
) -> tuple[float, float, float]:
    """Choose blend weights based on user temperature (interaction count + profile).

    Returns (w_content, w_collab, w_pop).
    """
    if interaction_count >= hot_threshold:
        return WEIGHTS_HOT
    if interaction_count >= warm_threshold:
        return WEIGHTS_WARM
    return WEIGHTS_WARM_NO_COLLAB if has_profile else WEIGHTS_COLD


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

    Zero-scored items are retained in the blend as long as at least one
    scorer produced data; only when all scorers are empty do we drop items.
    This preserves candidates with zero preference signal rather than
    silently collapsing the blend.
    """
    if not (content_scores or collab_scores or pop_scores):
        return {}

    w_content, w_collab, w_pop = weights
    skip = exclude or set()

    # Renormalize weights across scorers that actually produced data.
    effective_weights = [
        w_content if content_scores else 0.0,
        w_collab if collab_scores else 0.0,
        w_pop if pop_scores else 0.0,
    ]
    total_weight = sum(effective_weights)
    if total_weight > 0:
        w_content, w_collab, w_pop = (w / total_weight for w in effective_weights)
    else:
        w_content, w_collab, w_pop = 0.0, 0.0, 0.0

    blended: dict[int, float] = {}
    for eid in candidate_ids:
        if eid in skip:
            continue
        score = (
            w_content * content_scores.get(eid, 0)
            + w_collab * collab_scores.get(eid, 0)
            + w_pop * pop_scores.get(eid, 0)
        )
        blended[eid] = score
    return blended
