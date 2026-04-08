from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.user import UserResponse
from services import saved_event_service, user_service
from tests.conftest import FAKE_USER


def _mock_db_user(**overrides) -> UserResponse:
    defaults = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": FAKE_USER["email"],
        "username": "testuser",
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /saved-events/ ──────────────────────────────────────────────


def test_list_saved_events_requires_auth(client):
    response = client.get("/saved-events/")
    assert response.status_code == 401


def test_list_saved_events_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(saved_event_service, "get_saved_event_ids", MagicMock(return_value=[1, 3, 7]))

    resp = authenticated_client.get("/saved-events/")
    assert resp.status_code == 200
    assert resp.json() == [1, 3, 7]


# ── PUT /saved-events/{event_id} ────────────────────────────────────


def test_save_event_requires_auth(client):
    response = client.put("/saved-events/42")
    assert response.status_code == 401


def test_save_event_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(saved_event_service, "save_event", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-events/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"


# ── DELETE /saved-events/{event_id} ─────────────────────────────────


def test_unsave_event_requires_auth(client):
    response = client.delete("/saved-events/42")
    assert response.status_code == 401


def test_unsave_event_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(saved_event_service, "unsave_event", MagicMock(return_value=True))

    resp = authenticated_client.delete("/saved-events/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unsaved"
