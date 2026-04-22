from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.event import EventResponse
from schemas.user import UserResponse
from services import event_service, saved_event_service, user_service
from tests.conftest import FAKE_USER


def _mock_event(**overrides) -> EventResponse:
    defaults = {
        "id": 42,
        "title": "Mock Event",
        "location": "Nowhere",
        "organization": "MockOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


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
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=_mock_event()))
    monkeypatch.setattr(saved_event_service, "count_saved_events", MagicMock(return_value=0))
    monkeypatch.setattr(saved_event_service, "save_event", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-events/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"


def test_save_event_nonexistent_returns_404(authenticated_client, monkeypatch):
    """PUT to /saved-events/{event_id} returns 404 when the event does not exist."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-events/9999")
    assert resp.status_code == 404


def test_save_event_at_cap_returns_400(authenticated_client, monkeypatch):
    """Saving a new event when the user is at the cap returns 400."""
    from core.constants import MAX_SAVED_EVENTS_PER_USER

    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=_mock_event()))
    monkeypatch.setattr(saved_event_service, "count_saved_events", MagicMock(return_value=MAX_SAVED_EVENTS_PER_USER))

    resp = authenticated_client.put("/saved-events/42")
    assert resp.status_code == 400


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
