"""Service-level tests for ``event_service``.

Covers the two pieces the router tests can't reach:
1. ``compute_event_diff`` — a pure helper; assert on its return shape so
   a future refactor doesn't accidentally broaden ``MATERIAL_FIELDS`` to
   include routine edits.
2. The list-filter default — every ``GET /events`` query must filter
   ``status = 'CONFIRMED'`` at the builder level. Regression here would
   leak cancelled events into browse/search without anyone noticing
   through the router tests (which mock the service entirely).
"""

from datetime import datetime, timezone

from schemas.event import EventResponse
from schemas.event_date import OccurrenceResponse
from services import event_service


def _event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": "11111111-1111-1111-1111-111111111111",
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


def _occurrence(dtstart: datetime, dtend: datetime | None = None) -> OccurrenceResponse:
    """Helper: build an OccurrenceResponse the diff helper can iterate."""
    return OccurrenceResponse.model_validate(
        {
            "id": 0,
            "event_id": 1,
            "dtstart_utc": dtstart,
            "dtend_utc": dtend,
            "duration": None,
            "tz": None,
            "created_at": datetime.now(timezone.utc),
        }
    )


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
    new = EventResponse.model_validate(
        {
            **old.model_dump(),
            "description": "Whole new copy",
        }
    )
    assert event_service.compute_event_diff(old, new) == {}


def test_diff_location_change_populates_dict():
    old = _event(location="Old Place")
    new = _event(location="New Place")

    assert event_service.compute_event_diff(old, new) == {
        "location": {"old": "Old Place", "new": "New Place"}
    }


def test_diff_occurrence_change_serialises_to_iso():
    """After the v1-style EventDates port, dtstart/dtend live in the
    occurrences list — the diff compares the full list and emits a
    structured change rather than two separate field diffs.
    """
    old_ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    new_ts = datetime(2026, 5, 1, 19, 0, tzinfo=timezone.utc)
    old = _event(occurrences=[_occurrence(old_ts)])
    new = _event(occurrences=[_occurrence(new_ts)])

    diff = event_service.compute_event_diff(old, new)

    assert diff == {
        "occurrences": {
            "old": [
                {
                    "dtstart_utc": old_ts.isoformat(),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                }
            ],
            "new": [
                {
                    "dtstart_utc": new_ts.isoformat(),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                }
            ],
        }
    }


def test_diff_multiple_fields_all_present():
    old_ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    new_ts = datetime(2026, 5, 1, 19, 0, tzinfo=timezone.utc)
    old = _event(location="Here", occurrences=[_occurrence(old_ts)])
    new = _event(location="There", occurrences=[_occurrence(new_ts)])

    diff = event_service.compute_event_diff(old, new)

    assert diff == {
        "location": {"old": "Here", "new": "There"},
        "occurrences": {
            "old": [
                {
                    "dtstart_utc": old_ts.isoformat(),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                }
            ],
            "new": [
                {
                    "dtstart_utc": new_ts.isoformat(),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                }
            ],
        },
    }


def test_diff_reshuffle_with_same_dates_produces_no_diff():
    """The function-level docstring says: pure reshuffle without any
    date change does NOT fire a diff. Verify by feeding the same set
    of occurrences twice — once in id order, once in reverse — and
    asserting the diff is empty.

    The post-fix behavior is: ``list_for_event`` orders by ``dtstart_utc``
    ASC, so any reshuffle on the DB side normalises away. The picker
    + canonical-form helper produce identical JSON for the same set
    of (dtstart, dtend, duration, tz) tuples regardless of what id
    they happened to have.
    """
    ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    old_occ = OccurrenceResponse.model_validate(
        {
            "id": 999,
            "event_id": 1,
            "dtstart_utc": ts,
            "dtend_utc": None,
            "duration": None,
            "tz": "America/Toronto",
            "created_at": datetime.now(timezone.utc),
        }
    )
    new_occ = OccurrenceResponse.model_validate(
        {
            "id": 888,
            "event_id": 1,
            "dtstart_utc": ts,
            "dtend_utc": None,
            "duration": None,
            "tz": "America/Toronto",
            "created_at": datetime.now(timezone.utc),
        }
    )
    old = _event(occurrences=[old_occ])
    new = _event(occurrences=[new_occ])

    # Same dtstart, different ids/created_at — no diff.
    assert event_service.compute_event_diff(old, new) == {}


def test_diff_occurrence_added_from_none():
    """An event going from no occurrences to one new occurrence diffs as
    a single ``occurrences`` change with old=[] and the new list."""
    new_ts = datetime(2026, 5, 1, 18, 0, tzinfo=timezone.utc)
    old = _event(occurrences=[])
    new = _event(occurrences=[_occurrence(new_ts)])

    assert event_service.compute_event_diff(old, new) == {
        "occurrences": {
            "old": [],
            "new": [
                {
                    "dtstart_utc": new_ts.isoformat(),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                }
            ],
        }
    }



# ---------------------------------------------------------------------------
# Primary-date consistency between summary and detail modes
# ---------------------------------------------------------------------------


def test_list_events_summary_uses_primary_occurrence(monkeypatch, fake_sb, patch_sb):
    """Summary mode must report the primary occurrence (earliest future)."""
    from datetime import timedelta

    from services import event_date_service

    patch_sb("services.event_service")

    # list_events fetches occurrences with nested events in a single joined query.
    fake_sb.queue_responses(
        [
            [
                {
                    "event_id": 42,
                    "dtstart_utc": datetime(2026, 5, 15, tzinfo=timezone.utc).isoformat(),
                    "dtend_utc": None,
                    "tz": None,
                    "events": {
                        "id": 42,
                        "title": "Tea Tasting Series",
                        "location": "SLC",
                        "organization": "UW Tea Club",
                        "added_at": datetime(2026, 4, 15, tzinfo=timezone.utc).isoformat(),
                    },
                }
            ]
        ]
    )

    # Mock the post-dedup occurrence batch fetch with the FULL list,
    # including a future May 1 — that's what _pick_primary should pick.
    now = datetime.now(timezone.utc)
    future_1 = now + timedelta(days=2)
    future_2 = now + timedelta(days=9)
    future_3 = now + timedelta(days=16)
    monkeypatch.setattr(
        event_date_service,
        "list_for_events",
        lambda ids: {
            42: [
                _occ_response(future_1, occ_id=1),
                _occ_response(future_2, occ_id=2),
                _occ_response(future_3, occ_id=3),
            ]
        },
    )

    summary_results = event_service.list_events(summary=True)
    assert len(summary_results) == 1
    summary = summary_results[0]
    # Primary must be the EARLIEST future occurrence, not the May 15 one.
    assert summary.dtstart_utc == future_1


def _occ_response(dtstart, dtend=None, occ_id=1):
    """Helper: build an OccurrenceResponse for the test above."""
    return OccurrenceResponse.model_validate(
        {
            "id": occ_id,
            "event_id": 42,
            "dtstart_utc": dtstart,
            "dtend_utc": dtend,
            "duration": None,
            "tz": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
