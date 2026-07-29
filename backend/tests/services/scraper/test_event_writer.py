"""Unit tests for services/scraper/event_writer.

The writer inserts one events row plus N event_dates rows per logical event.
The tests assert on both layers via the fake_sb fixture.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from services.scraper import event_writer
from services.scraper.event_writer import (
    _clean_food,
    _coerce_future_occurrences,
    _parse_iso,
    write_event,
)

_REAL_ENSURE_ORGANIZATION_BY_IG = event_writer._ensure_organization_by_ig


@pytest.fixture(autouse=True)
def disable_organization_auto_create(monkeypatch):
    """Existing write_event tests focus on event persistence, not org creation."""
    monkeypatch.setattr(event_writer, "_ensure_organization_by_ig", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        event_writer.school_service,
        "get_school",
        lambda slug: SimpleNamespace(id=1, slug=slug),
    )


# ── _clean_food ───────────────────────────────────────────────────────


def test_clean_food_empty_returns_none():
    assert _clean_food(None) is None
    assert _clean_food([]) is None


def test_clean_food_rejects_string_shape():
    try:
        _clean_food("Pizza, Bubble tea")
    except ValueError:
        pass
    else:
        raise AssertionError("_clean_food accepted a string")


def test_clean_food_caps_at_20_items():
    too_many = [f"item{i}" for i in range(50)]
    assert len(_clean_food(too_many)) == 20


def test_clean_food_yes_marker_kept():
    assert _clean_food(["Yes!"]) == ["Yes!"]


# ── ISO parsing ───────────────────────────────────────────────────────


def test_parse_iso_handles_z_suffix():
    parsed = _parse_iso("2026-05-01T12:00:00Z")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc


def test_parse_iso_rejects_naive_datetime():
    assert _parse_iso("2026-05-01T12:00:00") is None


def test_parse_iso_invalid_returns_none():
    assert _parse_iso("not a date") is None
    assert _parse_iso(None) is None


# ── _coerce_future_occurrences ────────────────────────────────────────


def test_coerce_future_occurrences_drops_past():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    occurrences = [
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
        {"dtstart_utc": future, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ]
    cleaned = _coerce_future_occurrences(occurrences)
    assert len(cleaned) == 1
    # OccurrenceCreate dtstart is parsed; just check it's the future one.
    assert cleaned[0].dtstart_utc.isoformat().startswith(future[:13])


def test_coerce_future_occurrences_skips_invalid():
    """Invalid date strings drop quietly - one bad occurrence shouldn't kill the event."""
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    occurrences = [
        {"dtstart_utc": "not-a-date", "dtend_utc": "", "duration": "", "tz": "UTC"},
        {"dtstart_utc": future, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ]
    cleaned = _coerce_future_occurrences(occurrences)
    assert len(cleaned) == 1


# ── write_event paths ─────────────────────────────────────────────────


def _future(days: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _event(**overrides) -> dict:
    base = {
        "title": "Tea Tasting",
        "description": "Come try teas.",
        "location": "SLC 3223",
        "organization": "UW Tea Organization",
        "category": "Arts & Culture",
        # dtend left as empty string - OccurrenceCreate's
        # _dtend_after_dtstart validator only fires when dtend is set.
        "occurrences": [
            {
                "dtstart_utc": _future(2),
                "dtend_utc": "",
                "duration": "",
                "tz": "America/Toronto",
            }
        ],
        "image_index": 0,
        "price": 0.0,
        "food": ["Yes!"],
        "registration": False,
        "school": "uwaterloo",
    }
    base.update(overrides)
    return base


def test_write_event_skips_when_occurrences_empty(monkeypatch):
    """No occurrences -> "skipped" without touching the DB."""
    result = write_event(_event(occurrences=[]), ig_handle="x", source_url="u")
    assert result == "skipped"


def test_write_event_skips_when_required_fields_missing(monkeypatch):
    """Missing title or location -> skipped."""
    assert write_event(_event(title=""), ig_handle="x", source_url="u") == "skipped"
    assert write_event(_event(location=""), ig_handle="x", source_url="u") == "skipped"


def test_ensure_organization_by_ig_returns_existing_without_insert(fake_sb, patch_sb):
    patch_sb("services.scraper.event_writer")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 9,
                    "organization_name": "UW Tea Organization",
                }
            ]
        ]
    )

    result = _REAL_ENSURE_ORGANIZATION_BY_IG(
        "@uwteaorganization",
        school="uwaterloo",
        preferred_name="Ignored When Existing",
    )

    assert result == {
        "id": 9,
        "organization_name": "UW Tea Organization",
    }
    assert fake_sb.insert.call_count == 0


def test_ensure_organization_by_ig_creates_stub_when_missing(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    monkeypatch.setattr(
        event_writer.school_service,
        "get_school",
        lambda _slug: SimpleNamespace(id=1),
    )
    fake_sb.queue_responses(
        [
            [],
            [
                {
                    "id": 42,
                    "organization_name": "UW Tea Organization",
                }
            ],
        ]
    )

    result = _REAL_ENSURE_ORGANIZATION_BY_IG(
        "uwteaorganization",
        school="uwaterloo",
        preferred_name="UW Tea Organization",
    )

    assert result["id"] == 42
    insert_payload = fake_sb.insert.call_args_list[0][0][0]
    assert insert_payload == {
        "organization_name": "UW Tea Organization",
        "ig": "uwteaorganization",
        "school_id": 1,
    }


def test_ensure_organization_by_ig_skips_create_without_school(fake_sb, patch_sb):
    patch_sb("services.scraper.event_writer")
    fake_sb.queue_responses([[]])

    assert _REAL_ENSURE_ORGANIZATION_BY_IG("club", school=None) is None
    assert fake_sb.insert.call_count == 0


def test_write_event_links_auto_created_organization(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(event_writer, "_ensure_organization_by_ig", _REAL_ENSURE_ORGANIZATION_BY_IG)

    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses(
        [
            [],  # organization lookup miss
            [
                {
                    "id": 5,
                    "organization_name": "UW Tea Organization",
                }
            ],  # organization insert
            [{"id": 7}],  # events insert
            [
                {
                    "id": UUID(int=1),
                    "event_id": 7,
                    "dtstart_utc": _future(2),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                }
            ],
        ]
    )

    result = write_event(
        _event(),
        ig_handle="uwteaorganization",
        source_url="https://instagram.com/p/abc",
    )
    assert result == "inserted"

    dict_inserts = [
        call[0][0] for call in fake_sb.insert.call_args_list if isinstance(call[0][0], dict)
    ]
    assert dict_inserts[0]["ig"] == "uwteaorganization"
    assert dict_inserts[1]["organization_id"] == 5
    assert dict_inserts[1]["organization"] == "UW Tea Organization"
    assert "organization_type" not in dict_inserts[1]


def test_write_event_inserts_one_event_row_plus_occurrences(fake_sb, patch_sb, monkeypatch):
    """Multi-occurrence post -> ONE events row + N event_dates rows."""
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    # Sequence of execute responses the writer hits, in order:
    #   1. events insert -> [{"id": 7}]
    #   2. (event_date_service) event_dates insert -> [...] (>=1 row)
    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses(
        [
            [{"id": 7}],  # events insert
            # occurrences insert - return shape must satisfy OccurrenceResponse
            [
                {
                    "id": UUID(int=1),
                    "event_id": 7,
                    "dtstart_utc": _future(2),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                },
                {
                    "id": UUID(int=2),
                    "event_id": 7,
                    "dtstart_utc": _future(9),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                },
                {
                    "id": UUID(int=3),
                    "event_id": 7,
                    "dtstart_utc": _future(16),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                },
            ],
        ]
    )

    event = _event(
        occurrences=[
            {"dtstart_utc": _future(2), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(9), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(16), "dtend_utc": "", "duration": "", "tz": "UTC"},
        ],
    )
    result = write_event(
        event, ig_handle="uwteaorganization", source_url="https://instagram.com/p/abc"
    )
    assert result == "inserted"

    # The events insert should have been called exactly once, with one parent
    # row instead of one row per occurrence.
    insert_calls = [call for call in fake_sb.insert.call_args_list if isinstance(call[0][0], dict)]
    assert len(insert_calls) == 1
    payload = insert_calls[0][0][0]
    assert payload["title"] == "Tea Tasting"
    assert payload["ingestion_source"] == "instagram_scraper"
    assert "dtstart_utc" not in payload  # dates do NOT belong on the events row anymore

    # The event_dates insert should have received THREE rows (one per occurrence).
    list_inserts = [call for call in fake_sb.insert.call_args_list if isinstance(call[0][0], list)]
    assert len(list_inserts) == 1
    occ_payload = list_inserts[0][0][0]
    assert len(occ_payload) == 3
    assert all("dtstart_utc" in row for row in occ_payload)


def test_write_event_drops_past_occurrences(fake_sb, patch_sb, monkeypatch):
    """Past occurrences are filtered out before the events insert."""
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses(
        [
            [{"id": 11}],  # events insert
            # occurrences insert - only one survives the past-event filter
            [
                {
                    "id": UUID(int=1),
                    "event_id": 11,
                    "dtstart_utc": _future(2),
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                }
            ],
        ]
    )

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    event = _event(
        occurrences=[
            {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": future, "dtend_utc": "", "duration": "", "tz": "UTC"},
        ]
    )

    assert write_event(event, ig_handle="x", source_url="u") == "inserted"

    list_inserts = [call for call in fake_sb.insert.call_args_list if isinstance(call[0][0], list)]
    assert len(list_inserts) == 1
    occ_payload = list_inserts[0][0][0]
    assert len(occ_payload) == 1


def test_write_event_returns_skipped_when_all_occurrences_past(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    event = _event(
        occurrences=[
            {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
        ]
    )
    assert write_event(event, ig_handle="x", source_url="u") == "skipped"


def test_coerce_future_occurrences_allows_past_when_flag_set():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    occurrences = [
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ]
    cleaned = _coerce_future_occurrences(occurrences, allow_past_events=True)
    assert len(cleaned) == 1
    assert cleaned[0].dtstart_utc.isoformat().startswith(past[:13])


def test_write_event_keeps_past_occurrences_when_flag_set(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    occ_now = datetime.now(timezone.utc).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    fake_sb.queue_responses(
        [
            [{"id": 12}],  # events insert
            # occurrences insert - past occurrence survives due to flag
            [
                {
                    "id": UUID(int=1),
                    "event_id": 12,
                    "dtstart_utc": past,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": occ_now,
                }
            ],
        ]
    )

    event = _event(
        occurrences=[
            {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
        ]
    )
    assert write_event(event, ig_handle="x", source_url="u", allow_past_events=True) == "inserted"

    list_inserts = [call for call in fake_sb.insert.call_args_list if isinstance(call[0][0], list)]
    assert len(list_inserts) == 1
    occ_payload = list_inserts[0][0][0]
    assert len(occ_payload) == 1


def test_write_event_overwrites_by_id(fake_sb, patch_sb, monkeypatch):
    """Pass 2 id present -> one transactional parent + occurrence update."""
    from schemas.event import EventResponse

    patch_sb("services.scraper.event_writer")

    future = datetime.now(timezone.utc) + timedelta(days=2)
    base = {
        "id": 42,
        "title": "Tea Tasting",
        "location": "SLC 1000",
        "organization": "UW Tea Organization",
        "cancelled": False,
        "added_at": datetime.now(timezone.utc),
        "occurrences": [
            {
                "id": UUID(int=1),
                "event_id": 42,
                "dtstart_utc": future,
                "dtend_utc": None,
                "duration": None,
                "tz": None,
                "created_at": datetime.now(timezone.utc),
            }
        ],
    }
    old = EventResponse.model_validate(base)
    updated = EventResponse.model_validate({**base, "location": "SLC 3223", "cancelled": True})
    calls = {"n": 0}

    def _get_event(_eid: int):
        calls["n"] += 1
        return old if calls["n"] == 1 else updated

    monkeypatch.setattr(event_writer.event_service, "get_event", _get_event)
    monkeypatch.setattr(event_writer, "enqueue_event_change", lambda *a, **k: 1)
    update = MagicMock(return_value=[])
    monkeypatch.setattr(
        event_writer.event_service,
        "update_event_and_occurrences",
        update,
    )

    result = write_event(
        _event(id=42, location="SLC 3223", cancelled=True),
        ig_handle="uwteaorganization",
        source_url="https://instagram.com/p/abc",
    )
    assert result == "updated"
    update.assert_called_once()
    event_id, update_payload, occurrences = update.call_args.args
    assert event_id == 42
    assert update_payload["cancelled"] is True
    assert update_payload["location"] == "SLC 3223"
    assert len(occurrences) == 1


def test_write_event_refuses_cross_org_overwrite(fake_sb, patch_sb, monkeypatch):
    """Different organization_id on both sides → insert instead of overwrite."""
    from schemas.event import EventResponse
    from schemas.event_date import OccurrenceResponse
    from services.scraper.org_resolve import ResolvedOrganization

    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")

    future = datetime.now(timezone.utc) + timedelta(days=2)
    old = EventResponse.model_validate(
        {
            "id": 42,
            "organization_id": 7,
            "title": "Tea Tasting",
            "location": "SLC",
            "organization": "UW Tea",
            "ig_handle": "uwtea",
            "cancelled": False,
            "added_at": datetime.now(timezone.utc),
            "occurrences": [
                {
                    "id": UUID(int=1),
                    "event_id": 42,
                    "dtstart_utc": future,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": datetime.now(timezone.utc),
                }
            ],
        }
    )
    monkeypatch.setattr(event_writer.event_service, "get_event", lambda _eid: old)
    monkeypatch.setattr(
        event_writer.event_date_service,
        "create_occurrences",
        lambda eid, occs: [
            OccurrenceResponse.model_validate(
                {
                    "id": UUID(int=1),
                    "event_id": eid,
                    "dtstart_utc": future,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": None,
                    "created_at": datetime.now(timezone.utc),
                }
            )
        ],
    )
    fake_sb.queue_responses([[{"id": 99}]])  # insert fallback

    result = write_event(
        _event(id=42),
        ig_handle=None,
        source_url="https://directory.example/event",
        resolved_org=ResolvedOrganization(
            organization_id=99,
            organization_name="Other Club",
            ig_handle=None,
        ),
    )
    assert result == "inserted"
    assert fake_sb.update.call_count == 0
    assert fake_sb.insert.call_count == 1


def test_write_event_preserves_ig_and_org_on_null_incoming(fake_sb, patch_sb, monkeypatch):
    """Directory-style overwrite must not wipe IG provenance fields."""
    from schemas.event import EventResponse
    from services.scraper.org_resolve import ResolvedOrganization

    patch_sb("services.scraper.event_writer")

    future = datetime.now(timezone.utc) + timedelta(days=2)
    base = {
        "id": 42,
        "organization_id": 7,
        "title": "Tea Tasting",
        "location": "SLC 1000",
        "organization": "UW Tea Organization",
        "ig_handle": "uwteaorganization",
        "source_url": "https://instagram.com/p/OLD",
        "source_image_url": "https://cdn/old.jpg",
        "cancelled": False,
        "added_at": datetime.now(timezone.utc),
        "occurrences": [
            {
                "id": UUID(int=1),
                "event_id": 42,
                "dtstart_utc": future,
                "dtend_utc": None,
                "duration": None,
                "tz": None,
                "created_at": datetime.now(timezone.utc),
            }
        ],
    }
    old = EventResponse.model_validate(base)
    updated = EventResponse.model_validate({**base, "location": "SLC 3223"})
    calls = {"n": 0}

    def _get_event(_eid: int):
        calls["n"] += 1
        return old if calls["n"] == 1 else updated

    monkeypatch.setattr(event_writer.event_service, "get_event", _get_event)
    monkeypatch.setattr(event_writer, "enqueue_event_change", lambda *a, **k: 1)
    update = MagicMock(return_value=[])
    monkeypatch.setattr(
        event_writer.event_service,
        "update_event_and_occurrences",
        update,
    )

    result = write_event(
        _event(id=42, location="SLC 3223", source_image_url=None),
        ig_handle=None,
        source_url="",
        resolved_org=ResolvedOrganization(
            organization_id=7,
            organization_name="UW Tea Organization",
            ig_handle=None,
        ),
    )
    assert result == "updated"
    update.assert_called_once()
    update_payload = update.call_args.args[1]
    assert update_payload["ig_handle"] == "uwteaorganization"
    assert update_payload["organization_id"] == 7
    assert "organization_type" not in update_payload
    assert update_payload["source_url"] == "https://instagram.com/p/OLD"
    assert update_payload["source_image_url"] == "https://cdn/old.jpg"
