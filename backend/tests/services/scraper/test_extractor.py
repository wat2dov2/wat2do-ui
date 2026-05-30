"""Unit tests for the parts of services/wat2do/extractor that don't
need the OpenAI client.

The full ``extract_events_from_post`` round-trip is exercised by the
pipeline integration test with a mocked extractor; these tests pin the
JSON-parsing tolerance and ``_clean_event`` defaults that matter when
the model returns unexpected shapes.
"""

import pytest

from services.scraper.extractor import _clean_event, _parse_model_json

# ── _parse_model_json ────────────────────────────────────────────────


def test_parse_model_json_strict_array():
    assert _parse_model_json('[{"title":"x"}]') == [{"title": "x"}]


def test_parse_model_json_single_dict():
    """The model occasionally returns a single event dict instead of a
    one-element array. The pipeline wraps a dict response into a list,
    so ``_parse_model_json`` must return the dict (not None / [])."""
    result = _parse_model_json('{"title":"x"}')
    assert result == {"title": "x"}


def test_parse_model_json_strips_markdown_fences():
    assert _parse_model_json('```json\n[{"title":"x"}]\n```') == [{"title": "x"}]
    assert _parse_model_json('```\n[{"title":"x"}]\n```') == [{"title": "x"}]


def test_parse_model_json_handles_trailing_commentary():
    """Model emits the JSON, then a ``Note: …`` sentence despite the
    prompt asking for JSON only. Recover via the [first-bracket,
    last-bracket] slice fallback."""
    raw = '[{"title":"x"}]\n\nNote: this is a real event.'
    assert _parse_model_json(raw) == [{"title": "x"}]


def test_parse_model_json_returns_none_on_garbage():
    assert _parse_model_json("not json at all") is None
    assert _parse_model_json("") is None


def test_parse_model_json_handles_null_response():
    """The prompt says ``return null`` when no event is in the post —
    json.loads("null") returns None, and the caller drops it."""
    assert _parse_model_json("null") is None


# ── _clean_event ──────────────────────────────────────────────────────


def test_clean_event_fills_defaults_for_missing_fields():
    cleaned = _clean_event({"title": "X", "occurrences": [{"dtstart_utc": "2026-05-01T18:00:00Z"}]})
    # Missing fields get sensible defaults rather than KeyError downstream.
    assert cleaned["description"] == ""
    assert cleaned["location"] == ""
    assert cleaned["price"] is None
    assert cleaned["registration"] is False
    assert cleaned["food"] == ""
    assert cleaned["category"] is None
    assert cleaned["image_index"] == 0


def test_clean_event_free_event_coercion_on_title():
    """Free-event coercion: when the model returns ``price=null`` but
    the title contains "free", coerce price to 0.0. Pre-fix this only
    looked at description/food, missing posts where the FREE keyword
    sits in the title only."""
    cleaned = _clean_event({"title": "Free Pizza Friday", "price": None})
    assert cleaned["price"] == 0.0


def test_clean_event_free_event_coercion_on_description():
    cleaned = _clean_event({"title": "X", "description": "this event is free"})
    assert cleaned["price"] == 0.0


def test_clean_event_does_not_overwrite_explicit_price():
    """If the model returns a real numeric price, "free" in any field
    must NOT overwrite it."""
    cleaned = _clean_event(
        {
            "title": "Free time after a paid event",
            "description": "free pizza inside",
            "price": 15.0,
        }
    )
    assert cleaned["price"] == 15.0


def test_clean_event_category_normalized():
    cleaned = _clean_event({"title": "X", "category": "Music"})
    assert cleaned["category"] == "Music"


def test_clean_event_occurrences_sorted_and_normalized():
    cleaned = _clean_event(
        {
            "title": "X",
            "occurrences": [
                {"dtstart_utc": "2026-06-01T18:00:00Z"},
                {"dtstart_utc": "2026-05-01T18:00:00Z"},
            ],
        }
    )
    starts = [o["dtstart_utc"] for o in cleaned["occurrences"]]
    assert starts == ["2026-05-01T18:00:00Z", "2026-06-01T18:00:00Z"]
