"""Service-level tests for ``event_service``.

Covers the pieces the router tests can't reach:
1. ``compute_event_diff`` — a pure helper; assert on its return shape so
   a future refactor doesn't accidentally broaden ``MATERIAL_FIELDS`` to
   include routine edits.
2. ``list_events`` — the browse list returns the upcoming (today-or-later)
   event set for a school, hydrated with occurrences, and is cached
   per-school until a write invalidates it. The router tests mock the
   service entirely, so the query shape and cache behavior are only
   exercised here.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from core.constants import MAX_LIST_LIMIT
from core.exceptions import NotFoundError
from schemas.event import EventResponse, EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from schemas.organization import OrganizationResponse
from services import event_query, event_service, organization_service


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


def test_hydrate_event_reuses_validated_occurrences_without_json_dump(monkeypatch):
    """Hydration should not serialize occurrences only to parse them again."""
    occurrence = _occurrence(datetime(2026, 6, 1, 18, tzinfo=timezone.utc))

    def _fail_model_dump(self, *args, **kwargs):
        raise AssertionError("hydrate_event should pass occurrence models through directly")

    monkeypatch.setattr(OccurrenceResponse, "model_dump", _fail_model_dump)

    event = event_query.hydrate_event(
        {
            "id": 42,
            "title": "Fast Feed Night",
            "location": "SLC",
            "organization": "UW Blueprint",
            "added_at": datetime(2026, 5, 30, tzinfo=timezone.utc),
        },
        [occurrence],
        EventSummaryResponse,
    )

    assert event.id == 42
    assert event.occurrences[0].dtstart_utc == occurrence.dtstart_utc


def test_summary_columns_exclude_computed_response_fields():
    """Computed API fields must not be requested as physical events columns."""

    assert "occurrences" not in event_query._SUMMARY_COLUMNS
    assert "click_count" not in event_query._SUMMARY_COLUMNS


# ---------------------------------------------------------------------------
# _resolve_organization_fields — the single source for derived event display fields
# ---------------------------------------------------------------------------


def _organization(**overrides) -> OrganizationResponse:
    defaults = {
        "id": 7,
        "organization_name": "UW Tea Organization",
        "categories": [],
        "organization_page": None,
        "ig": None,
        "discord": None,
        "organization_type": "WUSA",
        "logo_url": None,
        "created_by": "11111111-1111-1111-1111-111111111111",
        "school": "University of Waterloo",
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


def test_resolve_organization_fields_derives_from_organization(monkeypatch):
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=_organization())
    )

    assert event_service._resolve_organization_fields(7) == {
        "organization": "UW Tea Organization",
        "organization_type": "WUSA",
        "school": "University of Waterloo",
    }


def test_resolve_organization_fields_missing_organization_raises(monkeypatch):
    monkeypatch.setattr(organization_service, "get_organization", MagicMock(return_value=None))

    with pytest.raises(NotFoundError):
        event_service._resolve_organization_fields(999)


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
    """dtstart/dtend live in the occurrences list.

    The diff compares the full list and emits a structured change rather than
    two separate field diffs.
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


def test_list_events_returns_upcoming_with_occurrences(monkeypatch, fake_sb, patch_sb):
    """The browse list hydrates each event with its full occurrence list."""
    from datetime import timedelta

    from services import event_date_service

    patch_sb("services.event_query")  # the upcoming-events query now lives here
    event_service.invalidate_events_cache()  # isolate from other tests' cache

    # The default feed first scans lightweight event IDs, then loads full rows
    # only for the current page; occurrences are batched separately.
    fake_sb.execute.side_effect = [
        MagicMock(data=[], count=1),
        MagicMock(
            data=[
                {
                    "event_id": 42,
                    "dtstart_utc": datetime(2026, 5, 15, tzinfo=timezone.utc).isoformat(),
                    "events": {"id": 42},
                }
            ],
            count=0,
        ),
        MagicMock(
            data=[
                {
                    "id": 42,
                    "title": "Tea Tasting Series",
                    "location": "SLC",
                    "organization": "UW Tea Organization",
                    "added_at": datetime(2026, 4, 15, tzinfo=timezone.utc).isoformat(),
                }
            ],
            count=0,
        ),
        MagicMock(data=[{"event_id": 42, "click_count": 5}], count=0),
    ]

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

    results, total = event_service.list_events(school="University of Waterloo")
    assert len(results) == 1
    assert total == 1
    assert results[0].click_count == 5
    assert len(results[0].occurrences) == 3
    assert results[0].occurrences[0].dtstart_utc == future_1

    # The query filters to occurrences starting today-or-later, scoped to school.
    fake_sb.eq.assert_any_call("events.school", "University of Waterloo")
    gte_bounds = [
        call.args[1]
        for call in fake_sb.gte.call_args_list
        if call.args and call.args[0] == "dtstart_utc"
    ]
    assert gte_bounds, "expected a dtstart_utc lower-bound filter"
    bound = datetime.fromisoformat(gte_bounds[0])
    assert bound <= datetime.now(timezone.utc)  # the boundary is start-of-today, never future


def test_list_events_is_cached_until_invalidated(monkeypatch):
    """Promoted-event lookup serves the all-upcoming source from cache."""
    event_service.invalidate_events_cache()
    calls = {"n": 0}

    def _fake_load(school):
        calls["n"] += 1
        return []

    monkeypatch.setattr(event_service, "_load_upcoming_events", _fake_load)
    monkeypatch.setattr(
        "services.credit_service.get_active_promoted_event_ids",
        MagicMock(return_value=[1]),
    )

    event_service.list_promoted_events(school="University of Waterloo")
    event_service.list_promoted_events(school="University of Waterloo")
    assert calls["n"] == 1  # second call is a cache hit

    event_service.invalidate_events_cache()
    event_service.list_promoted_events(school="University of Waterloo")
    assert calls["n"] == 2  # reloaded after invalidation


def test_list_events_pushes_filters_into_event_query(monkeypatch):
    event_service.invalidate_events_cache()
    mock_page = MagicMock(return_value=([], 0))
    monkeypatch.setattr(event_service.event_query, "load_events_page", mock_page)

    event_service.list_events(
        school="University of Waterloo",
        skip=50,
        limit=25,
        search="hack",
        categories=["Technology"],
        locations=["SLC"],
        foods=["Pizza"],
        days=["Friday"],
        min_price=0,
        max_price=20,
        registration=True,
        organizations=["UW Blueprint"],
        free_food=True,
        ids=[1, 2],
        sort_by="title",
        sort_order="desc",
    )

    _, kwargs = mock_page.call_args
    assert kwargs["school"] == "University of Waterloo"
    assert kwargs["offset"] == 50
    assert kwargs["limit"] == 25
    assert kwargs["cap"] == MAX_LIST_LIMIT
    assert kwargs["search"] == "hack"
    assert kwargs["categories"] == ["Technology"]
    assert kwargs["locations"] == ["SLC"]
    assert kwargs["foods"] == ["Pizza"]
    assert kwargs["days"] == ["Friday"]
    assert kwargs["min_price"] == 0
    assert kwargs["max_price"] == 20
    assert kwargs["registration"] is True
    assert kwargs["organizations"] == ["UW Blueprint"]
    assert kwargs["free_food"] is True
    assert kwargs["ids"] == [1, 2]
    assert kwargs["sort_by"] == "title"
    assert kwargs["sort_order"] == "desc"


def test_load_events_page_filters_counts_slices_and_hydrates(monkeypatch, fake_sb, patch_sb):
    """The shared query helper filters server-side and hydrates only the page slice."""
    from services import event_date_service

    patch_sb("services.event_query")
    fake_sb.set_response(
        data=[
            {
                "event_id": 1,
                "dtstart_utc": "2026-06-05T23:30:00+00:00",
                "dtend_utc": None,
                "tz": "America/Toronto",
                "events": {
                    "id": 1,
                    "title": "Alpha Hack Night",
                    "location": "SLC Great Hall",
                    "organization": "UW Blueprint",
                    "school": "University of Waterloo",
                    "category": "Technology",
                    "price": 0,
                    "food": ["Pizza"],
                    "registration": True,
                    "added_at": "2026-05-01T12:00:00+00:00",
                },
            },
            {
                # UTC Saturday, but Friday in the event timezone. This matches
                # the browser's old day filter intent instead of UTC weekday.
                "event_id": 2,
                "dtstart_utc": "2026-06-06T00:30:00+00:00",
                "dtend_utc": None,
                "tz": "America/Toronto",
                "events": {
                    "id": 2,
                    "title": "Beta Hack Night",
                    "location": "SLC Great Hall",
                    "organization": "UW Blueprint",
                    "school": "University of Waterloo",
                    "category": "Technology",
                    "price": 0,
                    "food": ["Pizza"],
                    "registration": True,
                    "added_at": "2026-05-02T12:00:00+00:00",
                },
            },
            {
                "event_id": 3,
                "dtstart_utc": "2026-06-06T19:00:00+00:00",
                "dtend_utc": None,
                "tz": "America/Toronto",
                "events": {
                    "id": 3,
                    "title": "Library Talk",
                    "location": "DC Library",
                    "organization": "Library Organization",
                    "school": "University of Waterloo",
                    "category": "Academic",
                    "price": 0,
                    "food": [],
                    "registration": False,
                    "added_at": "2026-05-03T12:00:00+00:00",
                },
            },
        ]
    )
    list_for_events = MagicMock(
        return_value={
            2: [
                _occ_response(
                    datetime(2026, 6, 6, 0, 30, tzinfo=timezone.utc),
                    occ_id=22,
                    event_id=2,
                )
            ]
        }
    )
    monkeypatch.setattr(event_date_service, "list_for_events", list_for_events)

    items, total = event_query.load_events_page(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school="University of Waterloo",
        offset=1,
        limit=1,
        cap=10,
        model=EventSummaryResponse,
        search="hack",
        categories=["Technology"],
        locations=["SLC"],
        foods=["Pizza"],
        days=["Friday"],
        min_price=0,
        max_price=0,
        registration=True,
        organizations=["UW Blueprint"],
        free_food=True,
        sort_by="title",
        sort_order="asc",
    )

    assert total == 2
    assert [event.id for event in items] == [2]
    assert items[0].occurrences[0].id == 22
    list_for_events.assert_called_once_with([2])
    fake_sb.eq.assert_any_call("events.school", "University of Waterloo")
    fake_sb.in_.assert_any_call("events.category", ["Technology"])
    fake_sb.in_.assert_any_call("events.organization", ["UW Blueprint"])
    fake_sb.eq.assert_any_call("events.registration", True)
    fake_sb.gte.assert_any_call("events.price", 0)
    fake_sb.lte.assert_any_call("events.price", 0)
    fake_sb.or_.assert_any_call(
        'title.ilike."%hack%",location.ilike."%hack%",organization.ilike."%hack%"',
        reference_table="events",
    )
    fake_sb.range.assert_any_call(0, 49)


def test_load_events_page_default_date_uses_lightweight_candidate_scan(
    monkeypatch, fake_sb, patch_sb
):
    """The unfiltered root feed avoids embedding full event rows for every candidate."""
    from services import event_date_service

    patch_sb("services.event_query")
    fake_sb.execute.side_effect = [
        MagicMock(data=[], count=2),
        MagicMock(
            data=[
                {
                    "event_id": 1,
                    "dtstart_utc": "2026-06-05T23:30:00+00:00",
                    "events": {"id": 1},
                },
                {
                    "event_id": 1,
                    "dtstart_utc": "2026-06-06T23:30:00+00:00",
                    "events": {"id": 1},
                },
                {
                    "event_id": 2,
                    "dtstart_utc": "2026-06-07T23:30:00+00:00",
                    "events": {"id": 2},
                },
            ],
            count=0,
        ),
        MagicMock(
            data=[
                {
                    "id": 2,
                    "title": "Beta Hack Night",
                    "location": "SLC Great Hall",
                    "organization": "UW Blueprint",
                    "school": "University of Waterloo",
                    "category": "Technology",
                    "price": 0,
                    "food": ["Pizza"],
                    "registration": True,
                    "source_image_url": "https://example.com/poster.webp",
                    "added_at": "2026-05-02T12:00:00+00:00",
                }
            ],
            count=0,
        ),
        MagicMock(data=[{"event_id": 2, "click_count": 7}], count=0),
    ]
    list_for_events = MagicMock(
        return_value={
            2: [
                _occ_response(
                    datetime(2026, 6, 7, 23, 30, tzinfo=timezone.utc),
                    occ_id=22,
                    event_id=2,
                )
            ]
        }
    )
    monkeypatch.setattr(event_date_service, "list_for_events", list_for_events)

    items, total = event_query.load_events_page(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school="University of Waterloo",
        offset=1,
        limit=1,
        cap=10,
        model=EventSummaryResponse,
    )

    assert total == 2
    assert [event.id for event in items] == [2]
    assert items[0].click_count == 7
    assert items[0].occurrences[0].id == 22
    list_for_events.assert_called_once_with([2])
    count_select = fake_sb.select.call_args_list[0].args[0]
    first_page_select = fake_sb.select.call_args_list[1].args[0]
    full_row_select = fake_sb.select.call_args_list[2].args[0]
    assert count_select == "id,event_dates!inner(id)"
    assert first_page_select == "id,event_id,dtstart_utc,events!inner(id)"
    assert "source_image_url" not in first_page_select
    assert "source_image_url" in full_row_select
    fake_sb.in_.assert_called_once_with("id", [2])
    order_calls = [(call.args[0], call.kwargs.get("desc")) for call in fake_sb.order.call_args_list]
    assert order_calls[:3] == [
        ("dtstart_utc", False),
        ("event_id", False),
        ("id", False),
    ]
    fake_sb.range.assert_any_call(0, 49)


def test_with_click_counts_fetches_counts_once(fake_sb, patch_sb):
    patch_sb("services.event_query")
    fake_sb.set_response(data=[{"event_id": 1, "click_count": 9}])

    rows = event_query.with_click_counts(
        [
            {"id": 1, "title": "Clicked"},
            {"id": 2, "title": "Quiet"},
        ]
    )

    assert [row["click_count"] for row in rows] == [9, 0]
    fake_sb.rpc.assert_called_once_with("get_event_click_counts", {"p_event_ids": [1, 2]})


def test_get_latest_added_event_filters_by_school(fake_sb, patch_sb):
    patch_sb("services.event_service")
    fake_sb.set_response(
        data=[
            {
                "title": "MIT Men's Soccer",
                "added_at": datetime(2026, 5, 15, 18, 0, tzinfo=timezone.utc).isoformat(),
            }
        ]
    )

    latest = event_service.get_latest_added_event("Massachusetts Institute of Technology")

    assert latest is not None
    assert latest.title == "MIT Men's Soccer"
    fake_sb.eq.assert_any_call("school", "Massachusetts Institute of Technology")


def _occ_response(dtstart, dtend=None, occ_id=1, event_id=42):
    """Helper: build an OccurrenceResponse for the test above."""
    return OccurrenceResponse.model_validate(
        {
            "id": occ_id,
            "event_id": event_id,
            "dtstart_utc": dtstart,
            "dtend_utc": dtend,
            "duration": None,
            "tz": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
