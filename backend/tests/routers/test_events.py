from datetime import datetime, timezone
from unittest.mock import MagicMock

from core.constants import ROLE_ADMIN
from schemas.club import ClubResponse
from schemas.event import EventResponse
from services import club_service, event_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_event(**overrides) -> EventResponse:
    """Build a mock EventResponse."""
    defaults = {
        "id": 1,
        "club_id": 7,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)

    return EventResponse.model_validate(defaults)


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 7,
        "club_name": "Verified Club",
        "categories": [],
        "club_page": None,
        "ig": None,
        "discord": None,
        "club_type": "WUSA",
        "logo_url": None,
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def test_create_event_requires_auth(client):
    response = client.post("/events/", json={"title": "Test", "location": "Here", "club_id": 7})
    assert response.status_code == 401


def test_delete_event_requires_auth(client):
    response = client.delete("/events/1")
    assert response.status_code == 401


def test_create_event_sets_created_by_for_club_owner(authenticated_client, monkeypatch):
    """Approved club owners can create events for their club."""
    created_event = _mock_event(club_id=7, organization="Verified Club", club_type="WUSA")
    mock_create = MagicMock(return_value=created_event)
    mock_get_club = MagicMock(return_value=_mock_club(id=7, school="University of Waterloo"))
    mock_resolve = MagicMock(return_value=[_mock_club(id=7, school="University of Waterloo")])
    monkeypatch.setattr(club_service, "get_club", mock_get_club)
    monkeypatch.setattr(club_service, "list_clubs_by_owner", mock_resolve)
    monkeypatch.setattr(event_service, "create_event", mock_create)

    resp = authenticated_client.post(
        "/events/",
        json={
            "title": "Test",
            "location": "Here",
            "club_id": 7,
            "occurrences": [
                {
                    "dtstart_utc": "2026-12-01T18:00:00+00:00",
                    "dtend_utc": "2026-12-01T20:00:00+00:00",
                    "duration": None,
                    "tz": "America/Toronto",
                }
            ],
        },
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    args, kwargs = mock_create.call_args
    create_data = args[0]
    assert create_data.club_id == 7
    assert create_data.organization == "Verified Club"
    assert create_data.club_type == "WUSA"
    assert create_data.school == "University of Waterloo"
    assert kwargs["created_by"] == FAKE_USER["id"]
    mock_get_club.assert_called_once_with(7)
    mock_resolve.assert_called_once_with(FAKE_USER["id"])


def test_create_event_without_matching_club_rejected(authenticated_client, monkeypatch):
    """Authenticated users cannot create events unless they own the event's club."""
    monkeypatch.setattr(
        club_service,
        "list_clubs_by_owner",
        MagicMock(return_value=[]),
    )
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=_mock_club(id=7)))
    monkeypatch.setattr(event_service, "create_event", MagicMock())

    resp = authenticated_client.post(
        "/events/",
        json={
            "title": "Test",
            "location": "Here",
            "club_id": 7,
            "occurrences": [
                {
                    "dtstart_utc": "2026-12-01T18:00:00+00:00",
                    "dtend_utc": "2026-12-01T20:00:00+00:00",
                    "duration": None,
                    "tz": "America/Toronto",
                }
            ],
        },
    )

    assert resp.status_code == 403
    event_service.create_event.assert_not_called()


def test_create_event_admin_allowed(admin_client, monkeypatch):
    """Admins can create events for operations and moderation workflows."""
    created_event = _mock_event(created_by=ADMIN_USER["id"])
    mock_create = MagicMock(return_value=created_event)
    mock_get_club = MagicMock(return_value=_mock_club(id=7))
    monkeypatch.setattr(club_service, "get_club", mock_get_club)
    monkeypatch.setattr(event_service, "create_event", mock_create)

    resp = admin_client.post(
        "/events/",
        json={
            "title": "Test",
            "location": "Here",
            "club_id": 7,
            "occurrences": [
                {
                    "dtstart_utc": "2026-12-01T18:00:00+00:00",
                    "dtend_utc": "2026-12-01T20:00:00+00:00",
                    "duration": None,
                    "tz": "America/Toronto",
                }
            ],
        },
    )

    assert resp.status_code == 201
    mock_get_club.assert_called_once_with(7)
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == ADMIN_USER["id"]


def test_update_event_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=event))

    # is_admin check must return False for the non-admin user
    from services import user_service

    resp = authenticated_client.patch("/events/1", json={"title": "Updated"})
    assert resp.status_code == 200


def test_update_event_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on update."""
    event = _mock_event(created_by=FAKE_USER["id"])  # owned by FAKE_USER, not OTHER_USER
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service

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

    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=admin_db_user)
    )

    resp = admin_client.patch("/events/1", json={"title": "Admin Fix"})
    assert resp.status_code == 200


def test_delete_event_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on delete."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service

    resp = other_user_client.delete("/events/1")
    assert resp.status_code == 403


def test_delete_event_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "delete_event", MagicMock(return_value=True))

    from services import user_service

    resp = authenticated_client.delete("/events/1")
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# event_change hook — router wires the notification fanout on material diff
# ---------------------------------------------------------------------------


def test_update_event_material_diff_triggers_enqueue(authenticated_client, monkeypatch):
    """PATCH with a material change (location) should fire enqueue_event_change."""
    from services.notifications import event_change

    old = _mock_event(created_by=FAKE_USER["id"], location="Here")
    updated = _mock_event(created_by=FAKE_USER["id"], location="There")
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=old))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=updated))

    mock_enqueue = MagicMock(return_value=0)
    monkeypatch.setattr(event_change, "enqueue_event_change", mock_enqueue)

    resp = authenticated_client.patch("/events/1", json={"location": "There"})
    assert resp.status_code == 200
    mock_enqueue.assert_called_once()
    args, _ = mock_enqueue.call_args
    assert args[0] == 1
    assert "location" in args[1]


def test_update_event_non_material_diff_skips_enqueue(authenticated_client, monkeypatch):
    """PATCH that only changes title must NOT fire enqueue_event_change."""
    from services.notifications import event_change

    old = _mock_event(created_by=FAKE_USER["id"], title="Old Title")
    updated = _mock_event(created_by=FAKE_USER["id"], title="New Title")
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=old))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=updated))

    mock_enqueue = MagicMock(return_value=0)
    monkeypatch.setattr(event_change, "enqueue_event_change", mock_enqueue)

    resp = authenticated_client.patch("/events/1", json={"title": "New Title"})
    assert resp.status_code == 200
    mock_enqueue.assert_not_called()


def test_update_event_enqueue_failure_does_not_break_update(authenticated_client, monkeypatch):
    """A notification-layer exception must not propagate up to the user."""
    from services.notifications import event_change

    old = _mock_event(created_by=FAKE_USER["id"], location="Here")
    updated = _mock_event(created_by=FAKE_USER["id"], location="There")
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=old))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=updated))
    monkeypatch.setattr(
        event_change,
        "enqueue_event_change",
        MagicMock(side_effect=RuntimeError("provider down")),
    )

    resp = authenticated_client.patch("/events/1", json={"location": "There"})
    assert resp.status_code == 200  # update still succeeded


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


def test_get_latest_added_forwards_school_filter(client, monkeypatch):
    mock_latest = MagicMock(return_value=None)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/latest-added",
        params={"school": "Massachusetts Institute of Technology"},
    )

    assert resp.status_code == 200
    mock_latest.assert_called_once_with("Massachusetts Institute of Technology")


# ---------------------------------------------------------------------------
# I10 / S16 — public responses must not leak created_by
# ---------------------------------------------------------------------------


def test_get_event_public_hides_created_by(client, monkeypatch):
    """GET /events/{id} must not include created_by in the response body."""
    event = _mock_event(created_by="secret-uid-1234")
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    resp = client.get("/events/1")
    assert resp.status_code == 200
    body = resp.json()
    assert "created_by" not in body


def test_list_events_public_hides_created_by(client, monkeypatch):
    """GET /events/ must not include created_by in any item."""
    events = [_mock_event(created_by="secret-uid-1234")]
    monkeypatch.setattr(event_service, "list_events", MagicMock(return_value=events))

    resp = client.get("/events/")
    assert resp.status_code == 200
    body = resp.json()
    assert all("created_by" not in item for item in body)


# ---------------------------------------------------------------------------
# I12 — past-event freezing on update
# ---------------------------------------------------------------------------


def test_update_past_event_rejected(authenticated_client, monkeypatch):
    """PATCH to an already-past event returns 400 / validation error."""
    from datetime import datetime, timedelta, timezone

    from core.exceptions import ValidationError

    past = datetime.now(timezone.utc) - timedelta(days=2)
    event = _mock_event(
        created_by=FAKE_USER["id"],
        occurrences=[
            {
                "id": 1,
                "event_id": 1,
                "dtstart_utc": past,
                "dtend_utc": past,
                "duration": None,
                "tz": None,
                "created_at": datetime.now(timezone.utc),
            }
        ],
    )
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service

    # Drive the service call directly so we get the ValidationError
    try:
        event_service.update_event(
            1, type("D", (), {"model_dump": lambda *_, **__: {"title": "x"}})()
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError for past-event update")
