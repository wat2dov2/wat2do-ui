"""Unit tests for services/wat2do/event_writer."""

from datetime import datetime, timedelta, timezone

from services.wat2do import event_writer
from services.wat2do.event_writer import (
    _coerce_food,
    _maybe_iso,
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


def test_maybe_iso_returns_none_for_empty():
    assert _maybe_iso("") is None
    assert _maybe_iso(None) is None


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
        "occurrences": [{
            "dtstart_utc": _future(2),
            "dtend_utc": _future(2),
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
    # ``find_match`` is the only DB caller before the early return; not
    # patching it would crash on the real client. Stub it out.
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    result = write_event(_event(occurrences=[]), ig_handle="x", source_url="u")
    assert result == "skipped"


def test_write_event_skips_when_required_fields_missing(monkeypatch):
    """Missing title or location -> skipped, no DB touch."""
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    assert write_event(_event(title=""), ig_handle="x", source_url="u") == "skipped"
    assert write_event(_event(location=""), ig_handle="x", source_url="u") == "skipped"


def test_write_event_inserts_one_row_per_occurrence(fake_sb, patch_sb, monkeypatch):
    """Multi-occurrence events become multiple events rows in v2's flat schema."""
    patch_sb("services.wat2do.event_writer")
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    fake_sb.set_response(data=[{"id": 1}])

    event = _event(
        occurrences=[
            {"dtstart_utc": _future(2), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(9), "dtend_utc": "", "duration": "", "tz": "UTC"},
            {"dtstart_utc": _future(16), "dtend_utc": "", "duration": "", "tz": "UTC"},
        ],
    )
    result = write_event(event, ig_handle="uwteaclub", source_url="https://instagram.com/p/abc")
    assert result == "inserted"

    # Confirm the insert was called with a list of three rows.
    fake_sb.insert.assert_called_once()
    rows = fake_sb.insert.call_args[0][0]
    assert isinstance(rows, list)
    assert len(rows) == 3
    # Same metadata across all rows; only the dtstart differs.
    titles = {row["title"] for row in rows}
    assert titles == {"Tea Tasting"}
    starts = {row["dtstart_utc"] for row in rows}
    assert len(starts) == 3


def test_write_event_drops_past_occurrences(fake_sb, patch_sb, monkeypatch):
    """Past occurrences are filtered out; only future ones become rows."""
    patch_sb("services.wat2do.event_writer")
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)
    fake_sb.set_response(data=[{"id": 1}])

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    event = _event(occurrences=[
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
        {"dtstart_utc": future, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ])

    assert write_event(event, ig_handle="x", source_url="u") == "inserted"
    rows = fake_sb.insert.call_args[0][0]
    assert len(rows) == 1


def test_write_event_returns_skipped_when_all_occurrences_past(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.wat2do.event_writer")
    monkeypatch.setattr(event_writer, "find_match", lambda **kw: None)

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    event = _event(occurrences=[
        {"dtstart_utc": past, "dtend_utc": "", "duration": "", "tz": "UTC"},
    ])
    assert write_event(event, ig_handle="x", source_url="u") == "skipped"
