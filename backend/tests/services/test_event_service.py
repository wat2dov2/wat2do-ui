"""Service-level tests for ``event_service``.

Covers the pieces the router tests can't reach:
1. ``compute_event_diff`` — a pure helper; assert on its return shape so
   a future refactor doesn't accidentally broaden ``MATERIAL_FIELDS`` to
   include routine edits.
2. ``list_events`` - the browse list returns the upcoming (today-or-later)
   event set for a school, hydrated with occurrences.
"""

import json
import threading
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from schemas.event import EventResponse, EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from services import club_service, event_query, event_service


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(event_query.school_service, "get_school_id", lambda _school: 1)


def _event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "title": "Test Event",
        "location": "Here",
        "club": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": "11111111-1111-1111-1111-111111111111",
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


@pytest.mark.parametrize("read", ["detail", "upcoming"])
def test_event_reads_do_not_retry_service_errors(monkeypatch, read):
    failure = MagicMock(side_effect=RuntimeError("Database unavailable"))
    if read == "detail":
        monkeypatch.setattr(event_service, "get_sb", failure)
        query = event_service.get_event
        kwargs = {"event_id": 1}
    else:
        monkeypatch.setattr(event_query, "_load_lightweight_date_page_ids", failure)
        query = event_query.load_upcoming_event_ids
        kwargs = {
            "since": datetime(2026, 9, 25, tzinfo=timezone.utc),
            "school": "uwaterloo",
            "cap": 20,
        }

    with pytest.raises(RuntimeError, match="Database unavailable"):
        query(**kwargs)

    assert failure.call_count == 1


def test_upcoming_event_ids_preserve_school_window_order_and_cap(monkeypatch):
    since = datetime(2026, 9, 25, tzinfo=timezone.utc)
    load_ids = MagicMock(return_value=[3, 1])
    monkeypatch.setattr(event_query, "_load_lightweight_date_page_ids", load_ids)

    result = event_query.load_upcoming_event_ids(since=since, school="uwaterloo", cap=20)

    assert result == [3, 1]
    load_ids.assert_called_once_with(
        start_utc=since, end_utc=None, school_id=1, offset=0, limit=20, cap=20
    )


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
            "club": "UW Blueprint",
            "clubs": {
                "logo_url": "https://example.com/uw-blueprint.jpg",
                "club_type": "wusa",
                "club_page": None,
                "ig": None,
                "discord": None,
            },
            "added_at": datetime(2026, 5, 30, tzinfo=timezone.utc),
        },
        [occurrence],
        EventSummaryResponse,
    )

    assert event.id == 42
    assert event.club_logo_url == "https://example.com/uw-blueprint.jpg"
    assert event.club_type == "wusa"
    assert event.occurrences[0].dtstart_utc == occurrence.dtstart_utc


@pytest.mark.parametrize(
    "model,items,expected",
    [
        pytest.param(EventSummaryResponse, [], False, id="no-publication"),
        pytest.param(
            EventSummaryResponse,
            [{"published_at": None, "instagram_publish_batches": {"status": "ready_for_review"}}],
            False,
            id="review-pending",
        ),
        pytest.param(
            EventSummaryResponse,
            [{"published_at": None, "instagram_publish_batches": {"status": "failed"}}],
            False,
            id="failed-unpublished",
        ),
        pytest.param(
            EventSummaryResponse,
            [{"published_at": None, "instagram_publish_batches": {"status": "publishing"}}],
            False,
            id="publishing-unconfirmed",
        ),
        pytest.param(
            EventSummaryResponse,
            [
                {
                    "published_at": "2026-09-28T12:00:00Z",
                    "instagram_publish_batches": {"status": "failed"},
                }
            ],
            True,
            id="publication-survives-later-batch-failure",
        ),
        pytest.param(
            EventSummaryResponse,
            [{"published_at": None, "instagram_publish_batches": {"status": "published"}}],
            True,
            id="published-batch",
        ),
        pytest.param(
            EventSummaryResponse,
            [{"published_at": None}, {"published_at": "2026-09-28T12:00:00Z"}],
            True,
            id="any-published-item",
        ),
        pytest.param(
            EventResponse,
            [{"published_at": "2026-09-28T12:00:00Z"}],
            True,
            id="detail-contract",
        ),
    ],
)
def test_featured_requires_instagram_publication(model, items, expected):
    event = event_query.hydrate_event(
        {
            "id": 29761,
            "title": "Campus night",
            "added_at": datetime(2026, 9, 30, tzinfo=timezone.utc),
            "featured": not expected,
            "instagram_publish_items": items,
        },
        [],
        model,
    )
    assert event.featured is expected
    assert "instagram_publish_items" not in event.model_dump()


def test_summary_columns_exclude_computed_response_fields():
    """Computed API fields must not be requested as physical events columns."""

    assert "featured" not in event_query._SUMMARY_COLUMNS
    assert "occurrences" not in event_query._SUMMARY_COLUMNS
    assert "club_logo_url" not in event_query._SUMMARY_COLUMNS
    assert "club_type" not in event_query._SUMMARY_COLUMNS
    assert "click_count" not in event_query._SUMMARY_COLUMNS


def test_browse_occurrences_reduce_payload_without_losing_selection_or_full_detail_fields():
    occurrences = [
        _occurrence(datetime(2026, 10, day, 18, tzinfo=timezone.utc)).model_copy(
            update={"id": UUID(int=day), "duration": "PT2H", "tz": "America/Toronto"}
        )
        for day in range(1, 7)
    ]
    row = {
        "id": 1,
        "title": "Recurring campus workshop",
        "description": "Searchable details remain intact, including advanced watercolor techniques.",
        "added_at": datetime(2026, 9, 26, tzinfo=timezone.utc),
    }
    summary = event_query.hydrate_event(row, occurrences, EventSummaryResponse).model_dump(
        mode="json"
    )
    detail = event_query.hydrate_event(row, occurrences, EventResponse).model_dump(mode="json")
    assert summary["description"] == row["description"]
    for compact, full in zip(summary["occurrences"], detail["occurrences"], strict=True):
        assert compact == {key: full[key] for key in ("id", "dtstart_utc", "dtend_utc")}
        assert full["event_id"] == 1
        assert full["duration"] == "PT2H"
        assert full["tz"] == "America/Toronto"

    legacy_summary = {**summary, "occurrences": detail["occurrences"]}
    compact_bytes = len(json.dumps(summary, separators=(",", ":")).encode())
    legacy_bytes = len(json.dumps(legacy_summary, separators=(",", ":")).encode())
    assert compact_bytes < legacy_bytes * 0.85


# ---------------------------------------------------------------------------
# _resolve_club_fields — the single source for derived event display fields
# ---------------------------------------------------------------------------


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
                "club": "UW Blueprint",
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


@pytest.mark.parametrize("count", [0, 1, 499, 500, 501, 1200])
def test_event_row_reads_preserve_batch_boundaries(fake_sb, patch_sb, count):
    patch_sb("services.event_query")
    ids = list(range(count))
    fake_sb.set_response(data=[])

    assert event_query._load_event_rows_by_ids(ids, columns="id,title") == []

    assert [call.args for call in fake_sb.in_.call_args_list] == [
        ("id", ids[start : start + 500]) for start in range(0, count, 500)
    ]


@pytest.mark.parametrize("model", [EventSummaryResponse, EventResponse])
@pytest.mark.parametrize(
    "ingestion_source,expected",
    [("directory", True), ("instagram_scraper", False), (None, False)],
)
def test_directory_event_identity_preserves_original_media(model, ingestion_source, expected):
    row = {
        "id": 1,
        "title": "Campus event",
        "school": "wlu",
        "source_url": "https://events.wlu.ca/2026/oct/campus-event.html",
        "source_image_url": "https://example.com/original.jpg",
        "added_at": datetime(2026, 9, 30, tzinfo=timezone.utc),
        "clubs": {"logo_url": "https://example.com/club.jpg"},
        "ingestion_source": ingestion_source,
    }
    event = event_query.hydrate_event(row, [], model)
    assert event.is_directory_event is expected
    assert event.source_image_url == "https://example.com/original.jpg"
    assert event.club_logo_url == "https://example.com/club.jpg"
    assert "ingestion_source" in event_query._SUMMARY_COLUMNS.split(",")
    assert "is_directory_event" not in event_query._SUMMARY_COLUMNS


@pytest.mark.parametrize("model", [EventSummaryResponse, EventResponse])
def test_directory_missing_host_picture_uses_union_without_renaming_host(monkeypatch, model):
    from schemas.directory_source import DirectorySource
    from services.ingestion import directory

    source = DirectorySource(
        id=1,
        school="cornell",
        name="Cornell CampusGroups",
        url="https://cornell.campusgroups.com/events",
        default_club="Cornell Student Assembly",
        default_club_ig="cornell_studentassembly",
        source_format="html",
        event_url_patterns=["/rsvp"],
    )
    monkeypatch.setattr(directory, "_sources_by_school", lambda: {"cornell": (source,)})
    lookup = MagicMock(return_value={"logo_url": "https://example.com/union.jpg"})
    monkeypatch.setattr(club_service, "lookup_club_by_school_and_ig", lookup)
    row = {
        "id": 1,
        "title": "SWAG Study Jam",
        "club": "Scholars Working Ambitiously to Graduate",
        "school": "cornell",
        "source_url": "https://cornell.campusgroups.com/rsvp?id=2313686",
        "added_at": datetime(2026, 9, 30, tzinfo=timezone.utc),
        "club_id": 7,
        "clubs": {"logo_url": None},
        "ingestion_source": "directory",
    }
    event = event_query.hydrate_event(row, [], model)
    assert event.club == "Scholars Working Ambitiously to Graduate"
    assert event.club_logo_url == "https://example.com/union.jpg"
    lookup.assert_called_once_with("cornell", "cornell_studentassembly")

    # Hosted by the university itself: no club, so no borrowed student union logo.
    university = {**row, "club": "Cornell University", "club_id": None, "clubs": None}
    assert event_query.hydrate_event(university, [], model).club_logo_url is None
