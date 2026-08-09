"""Unit tests for the parts of services/scraper/extractor that don't
need the OpenAI client.

The full extraction round-trip is exercised by the pipeline integration
test with a mocked extractor; these tests pin JSON parsing, triage, and
the validated defaults that matter when the model returns unexpected shapes.
"""

import pytest

from services.scraper import extractor
from services.scraper.extractor import (
    _clean_event,
    _clean_extracted_content,
    _clean_position,
    _parse_model_json,
)

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
    """The prompt says ``return null`` when no event is in the post -
    json.loads("null") returns None, and the caller drops it."""
    assert _parse_model_json("null") is None


def test_extraction_prompt_uses_school_slug(monkeypatch):
    calls = []
    monkeypatch.setattr(
        extractor,
        "resolve_school_timezone",
        lambda _school: "America/Vancouver",
    )
    monkeypatch.setattr(extractor, "current_semester_end", lambda *_args, **_kwargs: None)

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            message = type("Message", (), {"content": "null"})()
            choice = type("Choice", (), {"message": message})()
            return type("Response", (), {"choices": [choice]})()

    fake_client = type(
        "Client",
        (),
        {
            "chat": type(
                "Chat",
                (),
                {"completions": FakeCompletions()},
            )()
        },
    )()
    monkeypatch.setattr(extractor, "_client", lambda: fake_client)

    assert (
        extractor.extract_events_from_post(
            caption_text="Campus event",
            image_urls=[],
            post_created_at=None,
            school=" UBC ",
        )
        == []
    )

    prompt = calls[0]["messages"][1]["content"][0]["text"]
    assert "This post is from ubc." in prompt
    assert "University of British Columbia" not in prompt
    assert '"content_type": "event" | "hiring"' in prompt
    assert '"positions": [' in prompt


def test_clean_extracted_content_triages_hiring_positions():
    result = _clean_extracted_content(
        {
            "content_type": "hiring",
            "events": [],
            "positions": [
                {
                    "title": "Design Lead",
                    "description": "Lead the club's visual design work.",
                    "organization": "UW Design Club",
                    "position_type": "committee",
                    "requirements": ["Portfolio"],
                    "deadline_date": "2026-08-31",
                    "deadline_at": None,
                    "image_index": 1,
                }
            ],
        }
    )

    assert result.content_type == "hiring"
    assert result.events == []
    assert result.positions[0]["title"] == "Design Lead"
    assert result.positions[0]["deadline_date"] == "2026-08-31"


def test_clean_extracted_content_ignores_payloads_that_conflict_with_triage():
    result = _clean_extracted_content(
        {
            "content_type": "event",
            "events": [],
            "positions": [
                {
                    "title": "Design Lead",
                    "description": "Lead design.",
                    "position_type": "committee",
                }
            ],
        }
    )

    assert result.positions == []


# ── _clean_event ──────────────────────────────────────────────────────


def test_clean_event_fills_defaults_for_missing_fields():
    cleaned = _clean_event({"title": "X", "occurrences": [{"dtstart_utc": "2026-05-01T18:00:00Z"}]})
    # Missing fields get sensible defaults rather than KeyError downstream.
    assert cleaned["description"] == ""
    assert cleaned["location"] == ""
    assert cleaned["price"] is None
    assert cleaned["registration"] is False
    assert cleaned["food"] == []
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
    cleaned = _clean_event({"title": "X", "category": "Arts & Culture"})
    assert cleaned["category"] == "Arts & Culture"


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


def test_clean_position_normalizes_optional_fields():
    cleaned = _clean_position(
        {
            "title": "Volunteer Coordinator",
            "description": "Coordinate weekly volunteers.",
            "position_type": "volunteer",
            "requirements": ["Reliable communication"],
            "commitment": "",
            "deadline_date": "2026-09-01",
            "deadline_at": "",
        }
    )

    assert cleaned["commitment"] is None
    assert cleaned["deadline_at"] is None
    assert cleaned["deadline_date"] == "2026-09-01"
