from datetime import datetime, timezone
from random import Random
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from recommender import reranker
from schemas.event import EventResponse


@pytest.mark.parametrize("seed", range(8))
@pytest.mark.parametrize("lambda_param", [0.0, 0.5, 1.0])
@pytest.mark.parametrize("limit", [0, 1, 5, 20])
def test_reranking_matches_full_similarity_calculation(monkeypatch, seed, lambda_param, limit):
    random = Random(seed)
    vectors = {
        event_id: reranker._SparseVec(
            {dimension: float(random.randrange(3)) for dimension in range(6) if random.randrange(2)}
        )
        for event_id in range(seed + 3)
    }
    scored = [(event_id, random.randrange(5) / 4) for event_id in vectors]
    if seed % 2:
        scored.append((0, 0.75))
    random.shuffle(scored)
    monkeypatch.setattr(
        reranker,
        "_build_sparse_vector",
        lambda event_id, **kwargs: vectors[event_id],
    )
    scores = dict(scored)
    remaining = set(scores)
    expected = []
    for _ in range(min(limit, len(scores))):
        best_id = None
        best_score = -float("inf")
        for event_id in sorted(remaining, key=lambda item: (-scores[item], item)):
            vector = vectors[event_id]
            similarities = [0.0]
            for selected_id in expected:
                selected = vectors[selected_id]
                if vector.mag and selected.mag:
                    dot = sum(
                        value * selected.nz.get(dimension, 0)
                        for dimension, value in vector.nz.items()
                    )
                    similarities.append(dot / (vector.mag * selected.mag))
            score = lambda_param * scores[event_id] - (1 - lambda_param) * max(similarities)
            if score > best_score:
                best_id, best_score = event_id, score
        expected.append(best_id)
        remaining.remove(best_id)

    actual = reranker.mmr_rerank(
        scored,
        {event_id: event_id for event_id in vectors},
        lambda_param=lambda_param,
        k=limit,
    )

    assert actual == expected
    assert len(actual) == len(set(actual))


def test_empty_rankings_do_not_build_vectors(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("Empty rankings should not build vectors")

    monkeypatch.setattr(reranker, "_build_sparse_vector", unexpected)

    assert reranker.mmr_rerank([], {}) == []


def test_candidate_pairs_are_compared_once(monkeypatch):
    vectors = {event_id: reranker._SparseVec({event_id: 1.0}) for event_id in range(6)}
    monkeypatch.setattr(
        reranker,
        "_build_sparse_vector",
        lambda event_id, **kwargs: vectors[event_id],
    )
    compared = []
    original = reranker._sparse_cosine_sim

    def track_similarity(first, second):
        compared.append(frozenset((id(first), id(second))))
        return original(first, second)

    monkeypatch.setattr(reranker, "_sparse_cosine_sim", track_similarity)

    assert reranker.mmr_rerank(
        [(event_id, 1.0) for event_id in vectors],
        {event_id: event_id for event_id in vectors},
        k=4,
    ) == [0, 1, 2, 3]
    assert len(compared) == 12
    assert len(set(compared)) == len(compared)


def test_nonfinite_scores_preserve_remaining_candidate_tie_order():
    scores = [
        (20, 0.0),
        (18, -float("inf")),
        (15, 0.5),
        (5, float("nan")),
        (16, float("inf")),
        (6, 1.0),
        (7, float("nan")),
        (10, 0.5),
        (3, float("nan")),
        (19, 0.5),
        (9, float("inf")),
        (4, float("inf")),
        (1, 0.5),
        (14, -float("inf")),
        (17, -float("inf")),
        (0, float("inf")),
        (13, float("nan")),
        (12, 1.0),
        (11, float("inf")),
        (8, float("nan")),
        (2, -float("inf")),
    ]

    assert reranker.mmr_rerank(scores, {}, lambda_param=1.0, k=22) == [
        0,
        4,
        11,
        9,
        16,
        6,
        12,
        1,
        10,
        15,
        19,
        20,
    ]


@pytest.mark.parametrize("user_timezone", ["UTC", "America/Toronto"])
def test_reranking_uses_real_category_and_local_time_features(monkeypatch, user_timezone):
    now = datetime(2026, 9, 14, 9, tzinfo=timezone.utc)
    clock = MagicMock()
    clock.now.return_value = now
    clock.fromisoformat = datetime.fromisoformat
    monkeypatch.setattr(reranker, "datetime", clock)
    first_category, second_category = reranker.EVENT_CATEGORIES[:2]
    records = [
        (1, first_category, "2026-09-14T13:00:00+00:00"),
        (2, first_category, "2026-09-14T13:00:00+00:00"),
        (3, second_category, "2026-09-14T20:00:00+00:00"),
        (4, first_category, "2026-09-19T13:00:00+00:00"),
    ]
    events = {
        event_id: EventResponse.model_validate(
            {
                "id": event_id,
                "title": f"Event {event_id}",
                "location": "Campus",
                "category": category,
                "price": 0,
                "added_at": now,
                "occurrences": [
                    {
                        "id": UUID(int=event_id),
                        "event_id": event_id,
                        "dtstart_utc": starts_at,
                        "created_at": now,
                    }
                ],
            }
        )
        for event_id, category, starts_at in records
    }

    result = reranker.mmr_rerank(
        [(2, 1.0), (4, 1.0), (3, 1.0), (1, 1.0)],
        events,
        lambda_param=0.5,
        k=4,
        user_timezone=user_timezone,
    )

    assert result == [1, 3, 4, 2]
