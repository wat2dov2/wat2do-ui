from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.event import EventResponse
from schemas.user import UserResponse
from services import event_service, going_event_service, user_service
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
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /going-events/ ──────────────────────────────────────────────


def test_list_going_events_requires_auth(client):
    response = client.get("/going-events/")
    assert response.status_code == 401


def test_list_going_events_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(
        going_event_service, "get_going_event_ids", MagicMock(return_value=[1, 3, 7])
    )

    resp = authenticated_client.get("/going-events/")
    assert resp.status_code == 200
    assert resp.json() == [1, 3, 7]


# ── GET /going-events/counts ────────────────────────────────────────


def test_get_going_counts_public(client, monkeypatch):
    monkeypatch.setattr(
        going_event_service,
        "get_going_counts_for_school",
        MagicMock(return_value={"42": 3, "7": 1}),
    )

    resp = client.get("/going-events/counts", params={"school": "waterloo"})
    assert resp.status_code == 200
    assert resp.json() == {"42": 3, "7": 1}


def test_get_going_counts_requires_school(client):
    resp = client.get("/going-events/counts")
    assert resp.status_code == 422


# ── PUT /going-events/{event_id} ────────────────────────────────────


def test_mark_going_requires_auth(client):
    response = client.put("/going-events/42")
    assert response.status_code == 401


def test_mark_going_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=_mock_event()))
    monkeypatch.setattr(going_event_service, "count_going_events", MagicMock(return_value=0))
    monkeypatch.setattr(going_event_service, "mark_going", MagicMock(return_value=None))
    monkeypatch.setattr(going_event_service, "count_going_for_event", MagicMock(return_value=4))

    resp = authenticated_client.put("/going-events/42")
    assert resp.status_code == 200
    assert resp.json() == {"status": "going", "going_count": 4}


def test_mark_going_nonexistent_returns_404(authenticated_client, monkeypatch):
    """PUT to /going-events/{event_id} returns 404 when the event does not exist."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=None))

    resp = authenticated_client.put("/going-events/9999")
    assert resp.status_code == 404


def test_mark_going_at_cap_returns_400(authenticated_client, monkeypatch):
    """Marking a new event when the user is at the cap returns 400."""
    from core.constants import MAX_GOING_EVENTS_PER_USER

    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=_mock_event()))
    monkeypatch.setattr(
        going_event_service,
        "count_going_events",
        MagicMock(return_value=MAX_GOING_EVENTS_PER_USER),
    )

    resp = authenticated_client.put("/going-events/42")
    assert resp.status_code == 400


# ── DELETE /going-events/{event_id} ─────────────────────────────────


def test_unmark_going_requires_auth(client):
    response = client.delete("/going-events/42")
    assert response.status_code == 401


def test_unmark_going_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(going_event_service, "unmark_going", MagicMock(return_value=True))
    monkeypatch.setattr(going_event_service, "count_going_for_event", MagicMock(return_value=2))

    resp = authenticated_client.delete("/going-events/42")
    assert resp.status_code == 200
    assert resp.json() == {"status": "not_going", "going_count": 2}
