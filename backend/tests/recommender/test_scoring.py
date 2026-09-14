"""Contracts for recommendation weight selection and score blending."""

import pytest

from recommender import config, scoring


@pytest.mark.parametrize(
    "count,profile,expected",
    [
        (-1, False, config.WEIGHTS_COLD),
        (0, True, config.WEIGHTS_WARM_NO_COLLAB),
        (4, False, config.WEIGHTS_COLD),
        (5, False, config.WEIGHTS_WARM),
        (9, True, config.WEIGHTS_WARM),
        (10, False, config.WEIGHTS_HOT),
        (11, True, config.WEIGHTS_HOT),
    ],
)
def test_select_weights_preserves_tier_boundaries(count, profile, expected):
    assert scoring.select_weights(count, profile, hot_threshold=10, warm_threshold=5) == expected


def test_hot_tier_retains_precedence_when_thresholds_overlap():
    assert scoring.select_weights(4, False, hot_threshold=3, warm_threshold=8) == config.WEIGHTS_HOT


@pytest.mark.parametrize("candidate_ids", [[], [1], [1, 2, 1]])
def test_empty_scorers_produce_no_candidates(candidate_ids):
    assert scoring.blend_scores(candidate_ids, {}, {}, {}, (0.2, 0.5, 0.3)) == {}


def test_blend_redistributes_missing_scorer_weight():
    result = scoring.blend_scores(
        [1, 2, 3],
        {1: 0.8, 2: 0},
        {},
        {1: 0.2, 3: 0.9},
        (0.2, 0.5, 0.3),
    )

    assert result == pytest.approx({1: 0.44, 2: 0, 3: 0.54})


@pytest.mark.parametrize("weights", [(0, 0, 0), (0.2, 0.5, 0.3), (-1, 0, 0)])
def test_blend_retains_zero_signal_candidates_when_any_scorer_has_data(weights):
    assert scoring.blend_scores([1, 2], {99: 0}, {}, {}, weights) == {1: 0, 2: 0}


def test_blend_preserves_exclusions_and_first_candidate_order():
    result = scoring.blend_scores(
        [3, 1, 3, 2],
        {1: 0.2, 2: 0.5, 3: 0.8},
        {},
        {},
        (0.2, 0.5, 0.3),
        exclude={2},
    )

    assert list(result) == [3, 1]
    assert result == pytest.approx({3: 0.8, 1: 0.2})
