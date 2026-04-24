"""Service-level tests for ``event_service``.

Covers the two pieces the router tests can't reach:
1. ``compute_event_diff`` — a pure helper; assert on its return shape so
   a future refactor doesn't accidentally broaden ``MATERIAL_FIELDS`` to
   include routine edits.
2. The list-filter default — every ``GET /events`` query must filter
   ``status = 'active'`` at the builder level. Regression here would
   leak cancelled events into browse/search without anyone noticing
   through the router tests (which mock the service entirely).
"""

from datetime import datetime, timezone

from core.constants import EVENT_STATUS_ACTIVE, EVENT_STATUS_CANCELLED
from schemas.event import EventResponse
from services import event_service


def _event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": "11111111-1111-1111-1111-111111111111",
        "status": EVENT_STATUS_ACTIVE,
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


# ---------------------------------------------------------------------------
# compute_event_diff
# ---------------------------------------------------------------------------


def test_diff_no_change_returns_empty():
    event = _event()
    assert event_service.compute_event_diff(event, event) == {}


def test_diff_non_material_fields_ignored():
    old = _event(title="Old Title")
    new = _event(title="New Title")
    assert event_service.compute_event_diff(old, new) == {}


def test_diff_description_change_ignored():
    old = _event()
    new = EventResponse.model_validate({
        **old.model_dump(),
        "description": "Whole new copy",
    })
    assert event_service.compute_event_diff(old, new) == {}


def test_diff_status_change_populates_dict():
    old = _event(status=EVENT_STATUS_ACTIVE)
    new = _event(status=EVENT_STATUS_CANCELLED)

    diff = event_service.compute_event_diff(old, new)

    assert diff == {
        "status": {"old": EVENT_STATUS_ACTIVE, "new": EVENT_STATUS_CANCELLED}
    }


def test_diff_location_change_populates_dict():
    old = _event(location="Old Place")
    new = _event(location="New Place")

    assert event_service.compute_event_diff(old, new) == {
        "location": {"old": "Old Place", "new": "New Place"}
    }


def test_diff_dtstart_change_serialises_to_iso():
    old_ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    new_ts = datetime(2026, 5, 1, 19, 0, tzinfo=timezone.utc)
    old = _event(dtstart_utc=old_ts)
    new = _event(dtstart_utc=new_ts)

    diff = event_service.compute_event_diff(old, new)

    assert diff == {
        "dtstart_utc": {"old": old_ts.isoformat(), "new": new_ts.isoformat()}
    }


def test_diff_multiple_fields_all_present():
    old = _event(status=EVENT_STATUS_ACTIVE, location="Here")
    new = _event(status=EVENT_STATUS_CANCELLED, location="There")

    diff = event_service.compute_event_diff(old, new)

    assert diff == {
        "status": {"old": EVENT_STATUS_ACTIVE, "new": EVENT_STATUS_CANCELLED},
        "location": {"old": "Here", "new": "There"},
    }


def test_diff_dtstart_none_to_set():
    new_ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    old = _event(dtstart_utc=None)
    new = _event(dtstart_utc=new_ts)

    assert event_service.compute_event_diff(old, new) == {
        "dtstart_utc": {"old": None, "new": new_ts.isoformat()}
    }


# ---------------------------------------------------------------------------
# list_events — status filter
# ---------------------------------------------------------------------------


def test_list_events_default_filters_active(fake_sb, patch_sb):
    """By default, the list query must include .eq("status", "active")."""
    patch_sb("services.event_service")
    fake_sb.set_response(data=[])

    event_service.list_events()

    fake_sb.eq.assert_any_call("status", EVENT_STATUS_ACTIVE)


def test_list_events_include_cancelled_drops_status_filter(fake_sb, patch_sb):
    """When include_cancelled=True, the status filter must NOT be applied."""
    patch_sb("services.event_service")
    fake_sb.set_response(data=[])

    event_service.list_events(include_cancelled=True)

    calls = fake_sb.eq.call_args_list
    assert not any(c.args == ("status", EVENT_STATUS_ACTIVE) for c in calls)
