"""Shared utilities for recommender sub-modules."""


def normalize_scores(scores: dict[int, float]) -> dict[int, float]:
    """Normalize score values to [0, 1] by dividing by the max.

    Returns the dict unchanged (mutated in-place) for convenience.
    If the dict is empty, returns as-is.

    R11: When the max is <= 0 (all values non-positive, e.g. a user whose
    only interactions are unsaves), zero out the dict instead of leaving
    negative values in place -- negatives would otherwise flow through
    blend_scores and flip ordering against scorers already in [0, 1].
    """
    if scores:
        max_score = max(scores.values())
        if max_score > 0:
            for key in scores:
                scores[key] /= max_score
        else:
            for key in scores:
                scores[key] = 0.0
    return scores
