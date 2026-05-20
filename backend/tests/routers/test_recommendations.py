"""Tests for recommendations router auth and response paths."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.auth import get_optional_user
from main import app
from schemas.recommendation import RecommendationItem
from tests.conftest import FAKE_USER


def _mock_recs(n: int = 2) -> list[RecommendationItem]:
    return [
        RecommendationItem(event_id=i, score=1.0 - i * 0.1, reason="popular")
        for i in range(1, n + 1)
    ]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def optional_auth_client():
    """Client with get_optional_user overridden to return a fake user."""

    def fake_user():
        return FAKE_USER

    app.dependency_overrides[get_optional_user] = fake_user
    c = TestClient(app)
    yield c
    app.dependency_overrides.pop(get_optional_user, None)


# ── Public (no auth) ────────────────────────────────────────────────────


def test_recommendations_200_without_auth(client, monkeypatch):
    """GET /recommendations/ returns 200 without auth (popular recommendations)."""
    from services.recommendation_service import engine

    recs = _mock_recs()
    monkeypatch.setattr(engine, "get_popular_recommendations", MagicMock(return_value=recs))

    resp = client.get("/recommendations/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["event_id"] == 1
    assert data[0]["reason"] == "popular"


def test_recommendations_returns_popular_when_no_db_user(optional_auth_client, monkeypatch):
    """Authenticated user with no DB row falls back to popular recommendations."""
    from services import user_service
    from services.recommendation_service import engine

    recs = _mock_recs(3)
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))
    monkeypatch.setattr(engine, "get_popular_recommendations", MagicMock(return_value=recs))

    resp = optional_auth_client.get("/recommendations/")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


# ── Authenticated (personalized) ────────────────────────────────────────


def test_recommendations_200_with_auth_personalized(optional_auth_client, monkeypatch):
    """GET /recommendations/ returns personalized recs when user is authenticated and has a DB row."""
    from schemas.user import UserResponse
    from services import user_service
    from services.ab_test_service import ab_test
    from services.recommendation_service import engine

    db_user = UserResponse(
        id="00000000-0000-0000-0000-000000000001",
        email=FAKE_USER["email"],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))

    personalized_recs = [
        RecommendationItem(event_id=10, score=0.95, reason="content_based"),
        RecommendationItem(event_id=20, score=0.80, reason="collaborative"),
    ]
    monkeypatch.setattr(engine, "get_recommendations", MagicMock(return_value=personalized_recs))
    monkeypatch.setattr(ab_test, "get_user_variant", MagicMock(return_value="control"))
    monkeypatch.setattr(ab_test, "record_impressions", MagicMock())

    resp = optional_auth_client.get("/recommendations/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["event_id"] == 10
    assert data[0]["reason"] == "content_based"
    # Verify personalized path was taken
    engine.get_recommendations.assert_called_once()


def test_recommendations_respects_limit_param(client, monkeypatch):
    """GET /recommendations/?limit=1 passes the limit to the engine."""
    from services.recommendation_service import engine

    recs = _mock_recs(1)
    mock_popular = MagicMock(return_value=recs)
    monkeypatch.setattr(engine, "get_popular_recommendations", mock_popular)

    resp = client.get("/recommendations/?limit=1")
    assert resp.status_code == 200
    mock_popular.assert_called_once_with(limit=1)


def test_recommendations_ab_impression_failure_doesnt_break(optional_auth_client, monkeypatch):
    """If AB impression recording fails, recommendations are still returned."""
    from schemas.user import UserResponse
    from services import user_service
    from services.ab_test_service import ab_test
    from services.recommendation_service import engine

    db_user = UserResponse(
        id="00000000-0000-0000-0000-000000000002",
        email=FAKE_USER["email"],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))

    recs = _mock_recs()
    monkeypatch.setattr(engine, "get_recommendations", MagicMock(return_value=recs))
    monkeypatch.setattr(ab_test, "get_user_variant", MagicMock(return_value="treatment"))
    monkeypatch.setattr(
        ab_test, "record_impressions", MagicMock(side_effect=RuntimeError("DB down"))
    )

    resp = optional_auth_client.get("/recommendations/")
    assert resp.status_code == 200
    assert len(resp.json()) == 2
