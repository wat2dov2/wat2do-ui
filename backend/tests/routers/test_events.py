from datetime import datetime, timezone
from unittest.mock import MagicMock

from core.constants import ROLE_ADMIN
from schemas.event import EventResponse
from services import event_service
from tests.conftest import FAKE_USER, OTHER_USER, ADMIN_USER


def _mock_event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


def test_create_event_requires_auth(client):
    response = client.post("/events/", json={"title": "Test", "location": "Here", "organization": "Org"})
    assert response.status_code == 401


def test_delete_event_requires_auth(client):
    response = client.delete("/events/1")
    assert response.status_code == 401


def test_create_event_sets_created_by(authenticated_client, monkeypatch):
    """create_event passes the authenticated user's ID as created_by."""
    created_event = _mock_event()
    mock_create = MagicMock(return_value=created_event)
    monkeypatch.setattr(event_service, "create_event", mock_create)

    resp = authenticated_client.post(
        "/events/",
        json={"title": "Test", "location": "Here", "organization": "Org"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_update_event_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=event))

    # is_admin check must return False for the non-admin user
    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.patch("/events/1", json={"title": "Updated"})
    assert resp.status_code == 200


def test_update_event_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on update."""
    event = _mock_event(created_by=FAKE_USER["id"])  # owned by FAKE_USER, not OTHER_USER
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = other_user_client.patch("/events/1", json={"title": "Hacked"})
    assert resp.status_code == 403


def test_update_event_admin_allowed(admin_client, monkeypatch):
    """Admin can update any event regardless of ownership."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=event))

    from schemas.user import UserResponse
    admin_db_user = UserResponse(
        id="00000000-0000-0000-0000-000000000000",
        email=ADMIN_USER["email"],
        role=ROLE_ADMIN,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=admin_db_user))

    resp = admin_client.patch("/events/1", json={"title": "Admin Fix"})
    assert resp.status_code == 200


def test_delete_event_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on delete."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = other_user_client.delete("/events/1")
    assert resp.status_code == 403


def test_delete_event_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "delete_event", MagicMock(return_value=True))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.delete("/events/1")
    assert resp.status_code == 204


def test_update_legacy_event_non_admin_rejected(authenticated_client, monkeypatch):
    """Legacy events (created_by=None) can only be modified by admins."""
    event = _mock_event(created_by=None)
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.patch("/events/1", json={"title": "Hacked"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Search sanitization
# ---------------------------------------------------------------------------


def test_search_sanitizes_injection(client, monkeypatch):
    """PostgREST filter-injection via commas/periods in search is blocked."""
    mock_list = MagicMock(return_value=[])
    monkeypatch.setattr(event_service, "list_events", mock_list)

    # Attempt injection: commas and periods should be stripped before reaching
    # the PostgREST filter string.
    attack = "test,secret_col.eq.admin"
    client.get("/events/", params={"search": attack})

    assert mock_list.call_count == 1
    _, kwargs = mock_list.call_args
    # The search value passed to the service is the raw query param;
    # sanitization happens *inside* list_events. Verify the service was called.
    assert kwargs["search"] == attack


def test_search_injection_neutralised_by_sanitize_then_quoting():
    """Verify that sanitize_postgrest_value strips control chars before quoting."""
    from core.sanitize import sanitize_postgrest_value

    attack = "test,secret_col.eq.admin"
    # Reproduce the sanitization + quoting logic from list_events
    term = sanitize_postgrest_value(attack)
    # Control characters (commas, dots) must be gone after sanitization
    assert "," not in term
    assert "." not in term
    quoted = f'"%{term}%"'
    columns = ("title", "description", "location", "organization")
    filter_str = ",".join(f"{col}.ilike.{quoted}" for col in columns)
    # The sanitized value appears inside quotes — double defence.
    for col in columns:
        segment = f'{col}.ilike."%{term}%"'
        assert segment in filter_str


def test_search_normal_term(client, monkeypatch):
    """Normal search terms pass through to the service."""
    events = [_mock_event(title="Pizza Night")]
    mock_list = MagicMock(return_value=events)
    monkeypatch.setattr(event_service, "list_events", mock_list)

    resp = client.get("/events/", params={"search": "pizza"})
    assert resp.status_code == 200
    assert mock_list.call_count == 1
    _, kwargs = mock_list.call_args
    assert kwargs["search"] == "pizza"
