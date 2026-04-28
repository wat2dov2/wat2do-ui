"""Unit tests for services/wat2do/event_writer.

After the v1-style EventDates port (migration 20260428031741) the writer
inserts ONE events row plus N event_dates rows per logical event.
The tests assert on both layers via the fake_sb fixture.
"""

from datetime import datetime, timedelta, timezone

from services.wat2do import event_writer
from services.wat2do.event_writer import (
    _coerce_food,
    _coerce_future_occurrences,
    _parse_iso,
    _pick_first_canonical_category,
    write_event,
)


# ── _coerce_food ──────────────────────────────────────────────────────


def test_coerce_food_empty_returns_none():
    assert _coerce_food(None) is None
    assert _coerce_food("") is None
    assert _coerce_food([]) is None


def test_coerce_food_string_splits_on_comma_and_dedupes():
    """Mirrors v1's "Pizza, Bubble tea, pizza" -> ["Pizza", "Bubble tea"]."""
    assert _coerce_food("Pizza, Bubble tea, pizza ") == ["Pizza", "Bubble tea"]


def test_coerce_food_caps_at_20_items():
    too_many = ", ".join(f"item{i}" for i in range(50))
    assert len(_coerce_food(too_many)) == 20


def test_coerce_food_yes_marker_kept():
    """v1 emits the literal "Yes!" when food is mentioned but not listed."""
    assert _coerce_food("Yes!") == ["Yes!"]


# ── category picking ──────────────────────────────────────────────────


def test_pick_first_canonical_category_skips_non_canonical():
    """First canonical match wins; unknowns are dropped."""
    result = _pick_first_canonical_category(["Hogwarts", "Networking", "Career"])
    assert result == "Networking"


def test_pick_first_canonical_category_normalizes_legacy():
    """Legacy names like "Cultural" map to "Culture" via normalize_category."""
    result = _pick_first_canonical_category(["Cultural"])
    assert result == "Culture"


def test_pick_first_canonical_category_returns_none_when_empty():
    assert _pick_first_canonical_category([]) is None
    assert _pick_first_canonical_category(["NotARealCategory"]) is None


# ── ISO parsing ───────────────────────────────────────────────────────


def test_parse_iso_handles_z_suffix():
    parsed = _parse_iso("2026-05-01T12:00:00Z")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc


def test_parse_iso_naive_datetime_assumed_utc():
    """Bare datetimes are treated as UTC (defensive for legacy extractor output)."""
    parsed = _parse_iso("2026-05-01T12:00:00")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc


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
    """Invalid date strings drop quietly — one bad occurrence shouldn't kill the event."""
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
        "organization": "UW Tea Club",
        "categories": ["Food"],
        # dtend left as empty string — OccurrenceCreate's
        # _dtend_after_dtstart validator only fires when dtend is set.
        "occurrences": [{
            "dtstart_utc": _future(2),
            "dtend_utc": "",
            "duration": "",
            "tz": "America/Toronto",
        }],
        "image_index": 0,
        "price": 0.0,
        "food": "Yes!",
        "registration": False,
        "school": "University of Waterloo",
    }
    base.update(overrides)
    return base


def test_write_event_skips_when_occurrences_empty(monkeypatch):
    """No occurrences -> "skipped" without touching the DB."""
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    result = write_event(_event(occurrences=[]), ig_handle="x", source_url="u")
    assert result == "skipped"


def test_write_event_skips_when_required_fields_missing(monkeypatch):
    """Missing title or location -> skipped."""
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    assert write_event(_event(title=""), ig_handle="x", source_url="u") == "skipped"
    assert write_event(_event(location=""), ig_handle="x", source_url="u") == "skipped"


def test_write_event_inserts_one_event_row_plus_occurrences(fake_sb, patch_sb, monkeypatch):
    """Multi-occurrence post -> ONE events row + N event_dates rows."""
    patch_sb("services.wat2do.event_writer")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    # Sequence of execute responses the writer hits, in order:
    #   1. (event_writer) clubs lookup for club_type — _resolve_organization
    #      short-circuits because the event dict already has an organization.
    #   2. (event_writer) events insert -> [{"id": 7}]
    #   3. (event_date_service) event_dates insert -> [...] (>=1 row)
    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses([
        [],                       # clubs lookup for club_type
        [{"id": 7}],             # events insert
        # occurrences insert — return shape must satisfy OccurrenceResponse
        [
            {"id": "d1", "event_id": 7, "dtstart_utc": _future(2),  "dtend_utc": None, "duration": None, "tz": None, "created_at": occ_now},
            {"id": "d2", "event_id": 7, "dtstart_utc": _future(9),  "dtend_utc": None, "duration": None, "tz": None, "created_at": occ_now},
            {"id": "d3", "event_id": 7, "dtstart_utc": _future(16), "dtend_utc": None, "duration": None, "tz": None, "created_at": occ_now},
        ],
    ])

    event = _event(
        occurrences=[
            {"dtstart_utc": _future(2), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(9), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(16), "dtend_utc": "", "duration": "", "tz": "UTC"},
        ],
    )
    result = write_event(event, ig_handle="uwteaclub", source_url="https://instagram.com/p/abc")
    assert result == "inserted"

    # The events insert should have been called exactly once, with a SINGLE row payload
    # (not a list of three) — the v1-style port collapses multi-occurrence events to
    # one parent row.
    insert_calls = [
        call for call in fake_sb.insert.call_args_list
        if isinstance(call[0][0], dict)
    ]
    assert len(insert_calls) == 1
    payload = insert_calls[0][0][0]
    assert payload["title"] == "Tea Tasting"
    assert "dtstart_utc" not in payload  # dates do NOT belong on the events row anymore

    # The event_dates insert should have received THREE rows (one per occurrence).
    list_inserts = [
        call for call in fake_sb.insert.call_args_list
        if isinstance(call[0][0], list)
    ]
    assert len(list_inserts) == 1
    occ_payload = list_inserts[0][0][0]
    assert len(occ_payload) == 3
    assert all("dtstart_utc" in row for row in occ_payload)


def test_write_event_drops_past_occurrences(fake_sb, patch_sb, monkeypatch):
    """Past occurrences are filtered out before the events insert."""
    patch_sb("services.wat2do.event_writer")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses([
        [],                       # clubs club_type
        [{"id": 11}],             # events insert
        # occurrences insert — only one survives the past-event filter
        [{
            "id": "d1", "event_id": 11,
            "dtstart_utc": _future(2), "dtend_utc": None,
            "duration": None, "tz": None,
            "created_at": occ_now,
        }],
    ])

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    event = _event(occurrences=[
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
        {"dtstart_utc": future, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ])

    assert write_event(event, ig_handle="x", source_url="u") == "inserted"

    list_inserts = [
        call for call in fake_sb.insert.call_args_list
        if isinstance(call[0][0], list)
    ]
    assert len(list_inserts) == 1
    occ_payload = list_inserts[0][0][0]
    assert len(occ_payload) == 1


def test_write_event_returns_skipped_when_all_occurrences_past(monkeypatch):
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    event = _event(occurrences=[
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ])
    assert write_event(event, ig_handle="x", source_url="u") == "skipped"
