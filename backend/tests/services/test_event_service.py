"""Service-level tests for ``event_service``.

Covers the pieces the router tests can't reach:
1. ``compute_event_diff`` — a pure helper; assert on its return shape so
   a future refactor doesn't accidentally broaden ``MATERIAL_FIELDS`` to
   include routine edits.
2. ``list_events`` - the browse list returns the upcoming (today-or-later)
   event set for a school, hydrated with occurrences.
"""

import threading
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from postgrest.exceptions import APIError

from core.constants import MAX_LIST_LIMIT
from core.exceptions import NotFoundError
from schemas.event import EventResponse, EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from schemas.organization import OrganizationResponse
from services import event_query, event_service, organization_service


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(event_query.school_service, "get_school_id", lambda _school: 1)


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
            "id": str(UUID(int=0)),
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
            "organizations": {
                "organization_type": "wusa",
                "organization_page": None,
                "ig": None,
                "discord": None,
            },
            "added_at": datetime(2026, 5, 30, tzinfo=timezone.utc),
        },
        [occurrence],
        EventSummaryResponse,
    )

    assert event.id == 42
    assert event.organization_type == "wusa"
    assert event.occurrences[0].dtstart_utc == occurrence.dtstart_utc


def test_summary_columns_exclude_computed_response_fields():
    """Computed API fields must not be requested as physical events columns."""

    assert "occurrences" not in event_query._SUMMARY_COLUMNS
    assert "organization_type" not in event_query._SUMMARY_COLUMNS
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
        "organization_type": "wusa",
        "logo_url": None,
        "created_by": "11111111-1111-1111-1111-111111111111",
        "school": "uwaterloo",
        "school_id": 1,
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


def test_resolve_organization_fields_derives_from_organization(monkeypatch):
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=_organization())
    )

    assert event_service._resolve_organization_fields(7) == {
        "organization": "UW Tea Organization",
        "school_id": 1,
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


def test_diff_cancelled_change_populates_dict():
    old = _event(cancelled=False)
    new = _event(cancelled=True)

    assert event_service.compute_event_diff(old, new) == {"cancelled": {"old": False, "new": True}}


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
            "id": str(UUID(int=999)),
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
            "id": str(UUID(int=888)),
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

    monkeypatch.setattr(
        event_service,
        "resolve_school_timezone",
        lambda _school: "America/Toronto",
    )
    patch_sb("services.event_query")  # the upcoming-events query now lives here
    monkeypatch.setattr(event_query.school_service, "get_school_id", lambda _school: 1)
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

    results, total = event_service.list_events(school="uwaterloo")
    assert len(results) == 1
    assert total == 1
    assert len(results[0].occurrences) == 3
    assert results[0].occurrences[0].dtstart_utc == future_1

    # The query filters to occurrences starting today-or-later, scoped to school.
    fake_sb.eq.assert_any_call("events.school_id", 1)
    gte_bounds = [
        call.args[1]
        for call in fake_sb.gte.call_args_list
        if call.args and call.args[0] == "dtstart_utc"
    ]
    assert gte_bounds, "expected a dtstart_utc lower-bound filter"
    bound = datetime.fromisoformat(gte_bounds[0])
    assert bound <= datetime.now(timezone.utc)  # the boundary is start-of-today, never future


def test_list_promoted_events_queries_only_active_ids(monkeypatch):
    """Promoted lookup routes active IDs through the canonical paged query."""
    promoted = [EventSummaryResponse.model_validate(_event(id=1).model_dump())]
    mock_list = MagicMock(return_value=(promoted, 1))
    monkeypatch.setattr(event_service, "list_events", mock_list)
    monkeypatch.setattr(
        "services.credit_service.get_active_promoted_event_ids",
        MagicMock(return_value=[1, 2]),
    )

    result = event_service.list_promoted_events(school="uwaterloo")

    assert result == promoted
    mock_list.assert_called_once_with(
        school="uwaterloo",
        limit=MAX_LIST_LIMIT,
        ids=[1, 2],
    )


def test_list_events_pushes_filters_into_event_query(monkeypatch):
    mock_page = MagicMock(return_value=([], 0))
    monkeypatch.setattr(event_service.event_query, "load_events_page", mock_page)
    monkeypatch.setattr(
        event_service,
        "resolve_school_timezone",
        lambda _school: "America/Toronto",
    )

    event_service.list_events(
        school="uwaterloo",
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
        organization_ids=[7, 8],
        free_food=True,
        ids=[1, 2],
        sort_by="title",
        sort_order="desc",
    )

    _, kwargs = mock_page.call_args
    assert kwargs["school"] == "uwaterloo"
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
    assert kwargs["organization_ids"] == [7, 8]
    assert kwargs["free_food"] is True
    assert kwargs["ids"] == [1, 2]
    assert kwargs["sort_by"] == "title"
    assert kwargs["sort_order"] == "desc"


def test_load_events_page_filters_counts_slices_and_hydrates(monkeypatch, fake_sb, patch_sb):
    """The shared query helper filters server-side and hydrates only the page slice."""
    from services import event_date_service

    patch_sb("services.event_query")
    monkeypatch.setattr(event_query.school_service, "get_school_id", lambda _school: 1)
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
                    "school": "uwaterloo",
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
                    "school": "uwaterloo",
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
                    "school": "uwaterloo",
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
        school="uwaterloo",
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
        organization_ids=[7],
        free_food=True,
        sort_by="title",
        sort_order="asc",
    )

    assert total == 2
    assert [event.id for event in items] == [2]
    assert items[0].occurrences[0].id == UUID(int=22)
    list_for_events.assert_called_once_with([2])
    fake_sb.eq.assert_any_call("events.school_id", 1)
    fake_sb.in_.assert_any_call("events.category", ["Technology"])
    fake_sb.in_.assert_any_call("events.organization", ["UW Blueprint"])
    fake_sb.in_.assert_any_call("events.organization_id", [7])
    fake_sb.eq.assert_any_call("events.registration", True)
    fake_sb.gte.assert_any_call("events.price", 0)
    fake_sb.lte.assert_any_call("events.price", 0)
    fake_sb.or_.assert_any_call(
        'title.ilike."%hack%",location.ilike."%hack%",organization.ilike."%hack%"',
        reference_table="events",
    )
    fake_sb.range.assert_any_call(0, 49)


def test_load_events_page_default_date_uses_lightweight_candidate_scan(monkeypatch):
    """The unfiltered root feed avoids embedding full event rows for every candidate."""
    monkeypatch.setattr(event_query, "_count_lightweight_date_events", lambda **_: 2)
    monkeypatch.setattr(event_query, "_load_lightweight_date_page_ids", lambda **_: [2])
    monkeypatch.setattr(
        event_query,
        "_load_hydrated_events_by_ids",
        lambda *_args, **_kwargs: {
            2: EventSummaryResponse.model_validate(
                {
                    "id": 2,
                    "title": "Beta Hack Night",
                    "location": "SLC Great Hall",
                    "organization": "UW Blueprint",
                    "school": "uwaterloo",
                    "category": "Technology",
                    "price": 0,
                    "food": ["Pizza"],
                    "registration": True,
                    "source_image_url": "https://example.com/poster.webp",
                    "added_at": "2026-05-02T12:00:00+00:00",
                    "occurrences": [
                        _occ_response(
                            datetime(2026, 6, 7, 23, 30, tzinfo=timezone.utc),
                            occ_id=22,
                            event_id=2,
                        )
                    ],
                }
            )
        },
    )

    items, total = event_query.load_events_page(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school="uwaterloo",
        offset=1,
        limit=1,
        cap=10,
        model=EventSummaryResponse,
    )

    assert total == 2
    assert [event.id for event in items] == [2]
    assert items[0].occurrences[0].id == UUID(int=22)


def test_count_lightweight_date_events_uses_exact_embedded_count(fake_sb, patch_sb):
    patch_sb("services.event_query")
    fake_sb.set_response(count=2)

    total = event_query._count_lightweight_date_events(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school_id=1,
    )

    assert total == 2
    fake_sb.select.assert_called_once_with("id,event_dates!inner(id)", count="exact")
    fake_sb.limit.assert_called_once_with(0)


def test_load_lightweight_date_page_ids_scans_minimal_ordered_rows(fake_sb, patch_sb):
    patch_sb("services.event_query")
    fake_sb.set_response(
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
        ]
    )

    page_ids = event_query._load_lightweight_date_page_ids(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school_id=1,
        offset=1,
        limit=1,
        cap=10,
    )

    assert page_ids == [2]
    fake_sb.select.assert_called_once_with("id,event_id,dtstart_utc,events!inner(id)")
    order_calls = [(call.args[0], call.kwargs.get("desc")) for call in fake_sb.order.call_args_list]
    assert order_calls == [
        ("dtstart_utc", False),
        ("event_id", False),
        ("id", False),
    ]
    fake_sb.range.assert_any_call(0, 49)


def test_load_lightweight_date_page_overlaps_count_and_page_id_queries(monkeypatch):
    barrier = threading.Barrier(2, timeout=2)

    def count_events(**_kwargs):
        barrier.wait()
        return 0

    def load_page_ids(**_kwargs):
        barrier.wait()
        return []

    monkeypatch.setattr(event_query, "_count_lightweight_date_events", count_events)
    monkeypatch.setattr(event_query, "_load_lightweight_date_page_ids", load_page_ids)

    items, total = event_query._load_lightweight_date_page(
        start_utc=datetime(2026, 6, 1, tzinfo=timezone.utc),
        end_utc=None,
        school="uwaterloo",
        offset=0,
        limit=50,
        cap=5000,
        model=EventSummaryResponse,
    )

    assert items == []
    assert total == 0


def test_load_hydrated_events_overlaps_rows_and_occurrences(monkeypatch):
    from services import event_date_service

    barrier = threading.Barrier(2, timeout=2)

    def load_rows(_event_ids, *, columns):
        assert "source_image_url" in columns
        assert "source_url" in columns
        barrier.wait()
        return [
            {
                "id": 2,
                "title": "Beta Hack Night",
                "location": "SLC Great Hall",
                "organization": "UW Blueprint",
                "school": "uwaterloo",
                "category": "Technology",
                "price": 0,
                "food": ["Pizza"],
                "registration": True,
                "source_image_url": "https://example.com/poster.webp",
                "source_url": "https://example.com/events/beta-hack-night",
                "added_at": "2026-05-02T12:00:00+00:00",
            }
        ]

    def load_occurrences(event_ids):
        assert event_ids == [2]
        barrier.wait()
        return {
            2: [
                _occ_response(
                    datetime(2026, 6, 7, 23, 30, tzinfo=timezone.utc),
                    occ_id=22,
                    event_id=2,
                )
            ]
        }

    monkeypatch.setattr(event_query, "_load_event_rows_by_ids", load_rows)
    monkeypatch.setattr(event_date_service, "list_for_events", load_occurrences)

    events = event_query._load_hydrated_events_by_ids([2], model=EventSummaryResponse)

    assert events[2].occurrences[0].id == UUID(int=22)
    assert events[2].source_url == "https://example.com/events/beta-hack-night"


def test_get_event_stats_for_school_combines_positive_counts(monkeypatch):
    monkeypatch.setattr(
        event_service,
        "fetch_all_pages",
        MagicMock(return_value=[{"id": 1}, {"id": 2}, {"id": 3}]),
    )
    monkeypatch.setattr(
        event_service.interaction_service,
        "get_click_counts_for_events",
        MagicMock(return_value={1: 9}),
    )
    monkeypatch.setattr(
        event_service.going_event_service,
        "get_going_counts_for_events",
        MagicMock(return_value={2: 4}),
    )

    stats = event_service.get_event_stats_for_school("uwaterloo")

    assert {event_id: value.model_dump() for event_id, value in stats.items()} == {
        "1": {"click_count": 9, "going_count": 0},
        "2": {"click_count": 0, "going_count": 4},
    }
    event_service.interaction_service.get_click_counts_for_events.assert_called_once_with([1, 2, 3])
    event_service.going_event_service.get_going_counts_for_events.assert_called_once_with([1, 2, 3])


def test_get_event_stats_for_school_keeps_clicks_when_going_counts_fail(monkeypatch):
    monkeypatch.setattr(
        event_service,
        "fetch_all_pages",
        MagicMock(return_value=[{"id": 1}]),
    )
    monkeypatch.setattr(
        event_service.interaction_service,
        "get_click_counts_for_events",
        MagicMock(return_value={1: 9}),
    )
    monkeypatch.setattr(
        event_service.going_event_service,
        "get_going_counts_for_events",
        MagicMock(
            side_effect=APIError(
                {"message": "unavailable", "code": "08006", "details": "", "hint": ""}
            )
        ),
    )

    stats = event_service.get_event_stats_for_school("uwaterloo")

    assert {event_id: value.model_dump() for event_id, value in stats.items()} == {
        "1": {"click_count": 9, "going_count": 0},
    }


def test_get_latest_added_event_filters_by_school(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.event_service")
    monkeypatch.setattr(event_service.school_service, "get_school_id", lambda _school: 99)
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
    fake_sb.eq.assert_any_call("school_id", 99)


def test_get_organization_event_stats_aggregates_latest_and_count(fake_sb, patch_sb):
    patch_sb("services.event_service")
    fake_sb.set_response(
        data=[
            {
                "organization_id": 1,
                "title": "Newest Event",
                "added_at": "2026-05-03T12:00:00+00:00",
            },
            {
                "organization_id": 1,
                "title": "Older Event",
                "added_at": "2026-05-01T12:00:00+00:00",
            },
            {
                "organization_id": 2,
                "title": "Only Event",
                "added_at": "2026-05-02T12:00:00+00:00",
            },
        ]
    )

    stats = event_service.get_organization_event_stats([1, 2, 99])

    assert stats[1].event_count == 2
    assert stats[1].latest_event_title == "Newest Event"
    assert stats[2].event_count == 1
    assert stats[2].latest_event_title == "Only Event"
    assert stats[99].event_count == 0
    assert stats[99].latest_event_title is None


def _occ_response(dtstart, dtend=None, occ_id=1, event_id=42):
    """Helper: build an OccurrenceResponse for the test above."""
    return OccurrenceResponse.model_validate(
        {
            "id": str(UUID(int=occ_id)),
            "event_id": event_id,
            "dtstart_utc": dtstart,
            "dtend_utc": dtend,
            "duration": None,
            "tz": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
