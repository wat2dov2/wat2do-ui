import threading
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

from core.constants import ROLE_ADMIN
from core.pagination import LatestAddedItem
from schemas.club import ClubResponse
from schemas.event import EventResponse
from services import admin_query, club_service, event_query, event_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_event(**overrides) -> EventResponse:
    """Build a mock EventResponse."""
    defaults = {
        "id": 1,
        "club_id": 7,
        "title": "Test Event",
        "location": "Here",
        "club": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)

    return EventResponse.model_validate(defaults)


def _update_result(event: EventResponse) -> event_service.EventUpdateResult:
    return event_service.EventUpdateResult(event=event, recipient_ids=[])


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 7,
        "club_name": "Verified Club",
        "categories": [],
        "club_page": None,
        "ig": None,
        "discord": None,
        "club_type": "wusa",
        "logo_url": None,
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def test_create_event_requires_auth(client):
    response = client.post("/events/", json={"title": "Test", "location": "Here", "club_id": 7})
    assert response.status_code == 401


def test_admin_events_requires_auth(client):
    assert client.get("/events/admin").status_code == 401


def test_admin_events_requires_admin(authenticated_client):
    assert authenticated_client.get("/events/admin").status_code == 403


def test_admin_events_hydrates_one_filtered_page(admin_client, monkeypatch):
    select = MagicMock(return_value=(["7", "2"], 13086))
    hydrate = MagicMock(return_value={2: _mock_event(id=2), 7: _mock_event(id=7)})
    monkeypatch.setattr(admin_query, "load_page_ids", select)
    monkeypatch.setattr(event_query, "load_events_by_ids", hydrate)

    response = admin_client.get(
        "/events/admin?page=3&page_size=20&search=Dance&school=ulaval&category=Social"
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [7, 2]
    assert response.json()["total"] == 13086
    assert response.json()["total_pages"] == 655
    select.assert_called_once_with(
        "events", offset=40, limit=20, search="Dance", school="ulaval", category="Social"
    )
    assert hydrate.call_args.args == ([7, 2],)


def test_delete_event_requires_auth(client):
    response = client.delete("/events/1")
    assert response.status_code == 401


def test_create_event_sets_created_by_for_club_owner(authenticated_client, monkeypatch):
    """Approved club owners can create events for their club.

    The router only authorizes club ownership and forwards the raw payload;
    club/school are derived from club_id inside
    event_service.create_event (see test_resolve_club_fields_*).
    """
    created_event = _mock_event(
        club_id=7,
        club="Verified Club",
        club_type="wusa",
    )
    mock_create = MagicMock(return_value=created_event)
    mock_get_club = MagicMock(return_value=_mock_club(id=7, school="uwaterloo"))
    mock_resolve = MagicMock(return_value=[_mock_club(id=7, school="uwaterloo")])
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
    monkeypatch.setattr(
        event_service, "update_event", MagicMock(return_value=_update_result(event))
    )

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
    monkeypatch.setattr(
        event_service, "update_event", MagicMock(return_value=_update_result(event))
    )

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
    monkeypatch.setattr(
        event_service, "update_event", MagicMock(return_value=_update_result(updated))
    )

    mock_enqueue = MagicMock(return_value=0)
    monkeypatch.setattr(event_change, "enqueue_event_change", mock_enqueue)

    resp = authenticated_client.patch("/events/1", json={"location": "There"})
    assert resp.status_code == 200
    mock_enqueue.assert_called_once()
    args, _ = mock_enqueue.call_args
    assert args[0] == updated
    assert "location" in args[1]
    assert args[2] == []


def test_update_event_non_material_diff_skips_enqueue(authenticated_client, monkeypatch):
    """PATCH that only changes title must NOT fire enqueue_event_change."""
    from services.notifications import event_change

    old = _mock_event(created_by=FAKE_USER["id"], title="Old Title")
    updated = _mock_event(created_by=FAKE_USER["id"], title="New Title")
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=old))
    monkeypatch.setattr(
        event_service, "update_event", MagicMock(return_value=_update_result(updated))
    )

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
    monkeypatch.setattr(
        event_service, "update_event", MagicMock(return_value=_update_result(updated))
    )
    monkeypatch.setattr(
        event_change,
        "enqueue_event_change",
        MagicMock(side_effect=RuntimeError("provider down")),
    )

    resp = authenticated_client.patch("/events/1", json={"location": "There"})
    assert resp.status_code == 200  # update still succeeded


# ---------------------------------------------------------------------------
# Browse list — server returns the upcoming set by default; clients can ask
# for an explicit occurrence date window when they need a wider range.
# ---------------------------------------------------------------------------


def test_list_events_forwards_school_and_pagination(client, monkeypatch):
    """The router passes only school + pagination through to the service."""
    mock_list = MagicMock(return_value=([], 0))
    mock_latest = MagicMock(return_value=None)
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/",
        params={"school": "uwaterloo", "page": 2, "page_size": 50},
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "items": [],
        "total": 0,
        "page": 2,
        "page_size": 50,
        "total_pages": 0,
        "latest_added_event": None,
    }
    mock_list.assert_called_once_with(
        school="uwaterloo",
        skip=50,
        limit=50,
        start_utc=None,
        end_utc=None,
        search=None,
        categories=None,
        locations=None,
        foods=None,
        days=None,
        min_price=None,
        max_price=None,
        registration=None,
        clubs=None,
        club_ids=None,
        has_food=False,
        ids=None,
        sort_by="date",
        sort_order="asc",
        added_within_24h=False,
        include_past=False,
    )
    mock_latest.assert_called_once_with("uwaterloo")


def test_list_events_overlaps_feed_and_latest_event_queries(client, monkeypatch):
    barrier = threading.Barrier(2, timeout=2)

    def list_events(**_kwargs):
        barrier.wait()
        return [], 0

    def get_latest_added_event(_school):
        barrier.wait()
        return None

    monkeypatch.setattr(event_service, "list_events", list_events)
    monkeypatch.setattr(event_service, "get_latest_added_event", get_latest_added_event)

    response = client.get("/events/", params={"school": "uwaterloo"})

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["latest_added_event"] is None


def test_list_events_forwards_date_window(client, monkeypatch):
    """The public browse route exposes an occurrence UTC window."""
    mock_list = MagicMock(return_value=([], 0))
    mock_latest = MagicMock(return_value=None)
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/",
        params={
            "school": "uwaterloo",
            "start_utc": "1970-01-01T00:00:00+00:00",
            "end_utc": "2026-12-31T23:59:59+00:00",
        },
    )

    assert resp.status_code == 200
    mock_list.assert_called_once_with(
        school="uwaterloo",
        skip=0,
        limit=50,
        start_utc=datetime(1970, 1, 1, tzinfo=timezone.utc),
        end_utc=datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc),
        search=None,
        categories=None,
        locations=None,
        foods=None,
        days=None,
        min_price=None,
        max_price=None,
        registration=None,
        clubs=None,
        club_ids=None,
        has_food=False,
        ids=None,
        sort_by="date",
        sort_order="asc",
        added_within_24h=False,
        include_past=False,
    )
    mock_latest.assert_called_once_with("uwaterloo")


def test_list_events_forwards_filters_and_sort(client, monkeypatch):
    mock_list = MagicMock(return_value=([], 0))
    mock_latest = MagicMock(return_value=None)
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/",
        params=[
            ("school", "uwaterloo"),
            ("search", "hack"),
            ("categories", "Technology"),
            ("categories", "Career"),
            ("locations", "SLC"),
            ("foods", "Pizza"),
            ("days", "Friday"),
            ("min_price", "0"),
            ("max_price", "20"),
            ("registration", "true"),
            ("clubs", "UW Blueprint"),
            ("club_ids", "7"),
            ("club_ids", "8"),
            ("has_food", "true"),
            ("ids", "1"),
            ("ids", "2"),
            ("sort_by", "added_at"),
            ("sort_order", "desc"),
        ],
    )

    assert resp.status_code == 200
    mock_list.assert_called_once_with(
        school="uwaterloo",
        skip=0,
        limit=50,
        start_utc=None,
        end_utc=None,
        search="hack",
        categories=["Technology", "Career"],
        locations=["SLC"],
        foods=["Pizza"],
        days=["Friday"],
        min_price=0,
        max_price=20,
        registration=True,
        clubs=["UW Blueprint"],
        club_ids=[7, 8],
        has_food=True,
        ids=[1, 2],
        sort_by="added_at",
        sort_order="desc",
        added_within_24h=False,
        include_past=False,
    )
    mock_latest.assert_called_once_with("uwaterloo")


def test_list_events_forwards_added_within_24h(client, monkeypatch):
    mock_list = MagicMock(return_value=([], 0))
    mock_latest = MagicMock(return_value=None)
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/",
        params={
            "school": "uwaterloo",
            "added_within_24h": "true",
        },
    )

    assert resp.status_code == 200
    mock_list.assert_called_once_with(
        school="uwaterloo",
        skip=0,
        limit=50,
        start_utc=None,
        end_utc=None,
        search=None,
        categories=None,
        locations=None,
        foods=None,
        days=None,
        min_price=None,
        max_price=None,
        registration=None,
        clubs=None,
        club_ids=None,
        has_food=False,
        ids=None,
        sort_by="date",
        sort_order="asc",
        added_within_24h=True,
        include_past=False,
    )
    mock_latest.assert_called_once_with("uwaterloo")


def test_list_events_includes_latest_added_metadata(client, monkeypatch):
    latest = LatestAddedItem(
        title="MIT Men's Soccer",
        added_at=datetime(2026, 5, 15, 18, 0, tzinfo=timezone.utc),
    )
    mock_list = MagicMock(return_value=([], 0))
    mock_latest = MagicMock(return_value=latest)
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(event_service, "get_latest_added_event", mock_latest)

    resp = client.get(
        "/events/",
        params={"school": "Massachusetts Institute of Technology"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["latest_added_event"]["title"] == "MIT Men's Soccer"
    assert body["latest_added_event"]["added_at"].startswith("2026-05-15T18:00:00")
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
    events = [
        _mock_event(
            created_by="secret-uid-1234",
            source_url="https://example.com/events/test-event",
            occurrences=[
                {
                    "id": UUID(int=1),
                    "event_id": 1,
                    "dtstart_utc": datetime(2026, 9, 25, 18, tzinfo=timezone.utc),
                    "created_at": datetime(2026, 9, 24, tzinfo=timezone.utc),
                }
            ],
        )
    ]
    monkeypatch.setattr(event_service, "list_events", MagicMock(return_value=(events, 1)))
    monkeypatch.setattr(event_service, "get_latest_added_event", MagicMock(return_value=None))

    resp = client.get("/events/")
    assert resp.status_code == 200
    body = resp.json()
    assert all("created_by" not in item for item in body["items"])
    assert body["items"][0]["source_url"] == "https://example.com/events/test-event"
    assert body["items"][0]["occurrences"] == [
        {
            "id": str(UUID(int=1)),
            "event_id": 1,
            "dtstart_utc": "2026-09-25T18:00:00Z",
            "dtend_utc": None,
            "duration": None,
            "tz": None,
        }
    ]


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
                "id": UUID(int=1),
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


def test_get_event_stats_public(client, monkeypatch):
    mock_stats = MagicMock(
        return_value={
            "42": {"click_count": 8, "going_count": 3},
        }
    )
    monkeypatch.setattr(event_service, "get_event_stats_for_school", mock_stats)

    response = client.get("/events/stats", params={"school": "uwaterloo"})

    assert response.status_code == 200
    assert response.json() == {"42": {"click_count": 8, "going_count": 3}}
    mock_stats.assert_called_once_with("uwaterloo")


def test_get_event_stats_requires_school(client):
    response = client.get("/events/stats")
    assert response.status_code == 422


def test_create_event_rejected_while_club_awaits_review(authenticated_client, monkeypatch):
    """Membership in an unapproved club must not unlock publishing."""
    pending_club = _mock_club(id=7, school="uwaterloo", status="pending")
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=pending_club))
    mock_resolve = MagicMock(return_value=[pending_club])
    monkeypatch.setattr(club_service, "list_clubs_by_owner", mock_resolve)
    mock_create = MagicMock()
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

    assert resp.status_code == 403
    assert mock_create.call_count == 0
    # The membership lookup is never reached; approval is checked first.
    assert mock_resolve.call_count == 0
