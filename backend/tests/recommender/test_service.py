from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from unittest.mock import MagicMock, call

import pytest

from recommender.popularity import PopularityModel
from recommender.service import (
    BatchRecommendationRunner,
    RecommendationEngine,
    RecommendationSnapshot,
)
from schemas.event import EventResponse


def _event(event_id: int, school: str = "uwaterloo") -> EventResponse:
    return EventResponse.model_validate(
        {
            "id": event_id,
            "title": f"Event {event_id}",
            "location": "SLC",
            "organization": "Test Organization",
            "school": school,
            "added_at": datetime.now(timezone.utc),
        }
    )


def test_build_snapshot_loads_one_schools_inputs_once(monkeypatch):
    engine = RecommendationEngine()
    candidates = [
        MagicMock(id=1, school="uwaterloo"),
        MagicMock(id=2, school="uwaterloo"),
    ]
    collaborative_model = MagicMock()
    popularity_model = PopularityModel(scores={1: 0.8, 2: 0.2})

    monkeypatch.setattr(engine, "_load_candidate_events", MagicMock(return_value=candidates))
    engine._popularity_scorer = MagicMock(return_value={1: 0.8, 2: 0.2})

    snapshot = engine.build_snapshot(
        "uwaterloo",
        collaborative_model,
        popularity_model,
    )

    assert snapshot.candidates == tuple(candidates)
    assert snapshot.popularity_scores == {1: 0.8, 2: 0.2}
    assert snapshot.collaborative_model is collaborative_model
    engine._load_candidate_events.assert_called_once_with("uwaterloo")
    engine._popularity_scorer.assert_called_once_with(
        [1, 2],
        model=popularity_model,
    )


def test_build_snapshot_rejects_foreign_school_candidates(monkeypatch):
    engine = RecommendationEngine()
    monkeypatch.setattr(
        engine,
        "_load_candidate_events",
        MagicMock(return_value=[_event(1, school="utoronto")]),
    )

    with pytest.raises(RuntimeError, match="foreign events"):
        engine.build_snapshot(
            "uwaterloo",
            MagicMock(),
            PopularityModel(scores={}),
        )


def test_candidate_loader_passes_exact_school_to_shared_event_query(monkeypatch):
    load_upcoming = MagicMock(return_value=[])
    monkeypatch.setattr(
        "recommender.service.event_query.load_upcoming_events",
        load_upcoming,
    )

    assert RecommendationEngine._load_candidate_events("uwaterloo") == []
    assert load_upcoming.call_args.kwargs["school"] == "uwaterloo"
    assert load_upcoming.call_args.kwargs["cap"] == 1000
    assert load_upcoming.call_args.kwargs["model"] is EventResponse


def test_batch_runner_shares_one_snapshot_per_school(monkeypatch):
    collaborative_model = MagicMock()
    popularity_model = PopularityModel(scores={1: 0.8, 2: 0.7})
    waterloo_snapshot = RecommendationSnapshot(
        candidates=(_event(1, school="uwaterloo"),),
        popularity_scores={},
        collaborative_model=collaborative_model,
    )
    toronto_snapshot = RecommendationSnapshot(
        candidates=(_event(2, school="utoronto"),),
        popularity_scores={},
        collaborative_model=collaborative_model,
    )
    engine = MagicMock()
    engine.build_shared_collaborative_model.return_value = collaborative_model
    engine.build_shared_popularity_model.return_value = popularity_model
    engine.build_snapshot.side_effect = lambda school, _collaborative, _popularity: {
        "uwaterloo": waterloo_snapshot,
        "utoronto": toronto_snapshot,
    }[school]
    engine.make_executor.side_effect = lambda max_workers: ThreadPoolExecutor(
        max_workers=max_workers
    )
    engine.compute_and_store.return_value = []

    runner = BatchRecommendationRunner(engine)
    monkeypatch.setattr(
        runner,
        "_iter_all_users",
        lambda: iter(
            [
                {"id": "u1", "school": "utoronto"},
                {"id": "u2", "school": "uwaterloo"},
                {"id": "u3", "school": "uwaterloo"},
            ]
        ),
    )

    result = runner.compute_all_users(max_workers=2)

    assert result == {
        "total_users": 3,
        "processed": 3,
        "failed": 0,
        "failed_ids": [],
    }
    engine.build_shared_collaborative_model.assert_called_once_with()
    engine.build_shared_popularity_model.assert_called_once_with()
    assert engine.build_snapshot.call_args_list == [
        call("utoronto", collaborative_model, popularity_model),
        call("uwaterloo", collaborative_model, popularity_model),
    ]
    assert engine.compute_and_store.call_count == 3
    snapshot_by_user = {
        call.args[0]: call.kwargs["snapshot"] for call in engine.compute_and_store.call_args_list
    }
    assert snapshot_by_user == {
        "u1": toronto_snapshot,
        "u2": waterloo_snapshot,
        "u3": waterloo_snapshot,
    }


def test_batch_runner_clears_schoolless_users_without_loading_candidates(monkeypatch):
    engine = MagicMock()
    engine.make_executor.side_effect = lambda max_workers: ThreadPoolExecutor(
        max_workers=max_workers
    )
    engine.compute_and_store.return_value = []
    runner = BatchRecommendationRunner(engine)
    monkeypatch.setattr(
        runner,
        "_iter_all_users",
        lambda: iter([{"id": "u1", "school": None}]),
    )

    result = runner.compute_all_users(max_workers=1)

    assert result["processed"] == 1
    engine.build_shared_collaborative_model.assert_not_called()
    engine.build_shared_popularity_model.assert_not_called()
    engine.build_snapshot.assert_not_called()
    snapshot = engine.compute_and_store.call_args.kwargs["snapshot"]
    assert snapshot.candidates == ()


def test_empty_nightly_result_clears_previous_snapshot(monkeypatch):
    engine = RecommendationEngine()
    snapshot = RecommendationSnapshot(
        candidates=(),
        popularity_scores={},
        collaborative_model=None,
    )
    monkeypatch.setattr(engine, "_compute_from_snapshot", MagicMock(return_value=[]))
    monkeypatch.setattr(engine, "_store_user_recs", MagicMock())

    assert engine.compute_and_store("u1", snapshot=snapshot) == []
    engine._store_user_recs.assert_called_once_with("u1", [])


def test_snapshot_fallback_does_not_reload_live_inputs(monkeypatch):
    engine = RecommendationEngine()
    snapshot = RecommendationSnapshot(
        candidates=(_event(1), _event(2)),
        popularity_scores={1: 0.2, 2: 0.9},
        collaborative_model=None,
    )

    monkeypatch.setattr("recommender.service.user_service.get_user", lambda _user_id: None)
    monkeypatch.setattr(
        "recommender.service.interaction_service.get_user_interaction_count",
        lambda _user_id: 0,
    )
    monkeypatch.setattr(
        "recommender.service.get_user_event_scores",
        lambda _user_id: {},
    )
    monkeypatch.setattr("recommender.service.blend_scores", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        engine,
        "_load_candidate_events",
        MagicMock(side_effect=AssertionError("nightly fallback must reuse the snapshot")),
    )

    result = engine._compute_from_snapshot("u1", snapshot, limit=1)

    assert [item.event_id for item in result] == [2]
    engine._load_candidate_events.assert_not_called()


def test_live_read_returns_empty_without_nightly_snapshot(monkeypatch):
    engine = RecommendationEngine()
    monkeypatch.setattr(
        engine,
        "_fetch_precomputed_recs",
        MagicMock(return_value=MagicMock(data=[])),
    )
    monkeypatch.setattr(
        engine,
        "_load_candidate_events",
        MagicMock(side_effect=AssertionError("live reads must not compute a fallback")),
    )

    assert engine.get_recommendations("u1") == []
    engine._load_candidate_events.assert_not_called()


def test_live_read_fails_closed_when_snapshot_future_check_fails(monkeypatch):
    engine = RecommendationEngine()
    monkeypatch.setattr(
        engine,
        "_fetch_precomputed_recs",
        MagicMock(
            return_value=MagicMock(
                data=[
                    {
                        "event_id": 1,
                        "predicted_score": 0.8,
                        "reason": "Recommended",
                        "computed_at": datetime.now(timezone.utc).isoformat(),
                    }
                ]
            )
        ),
    )
    monkeypatch.setattr(engine, "_fetch_recent_actions", MagicMock(return_value=set()))
    monkeypatch.setattr(
        engine,
        "_fetch_future_event_ids",
        MagicMock(side_effect=RuntimeError("database unavailable")),
    )

    assert engine.get_recommendations("u1") == []
