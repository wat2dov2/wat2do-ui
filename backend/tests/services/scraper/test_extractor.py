"""Unit tests and optional live-model regressions for event extraction.

The full extraction round-trip is exercised by the pipeline integration
test with a mocked extractor; these tests pin JSON parsing, triage, and
the validated defaults that matter when the model returns unexpected shapes.
"""

import json
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from services.scraper import extractor
from services.scraper.extractor import (
    _clean_event,
    _clean_extracted_content,
    _clean_position,
    _parse_model_json,
)

# ── _parse_model_json ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "caption",
    [
        "Original caption with details.",
        "x" * (extractor.MAX_POSITION_DESCRIPTION_LENGTH + 1),
        None,
        "   ",
    ],
)
def test_extraction_attaches_source_fields_without_model_copying(monkeypatch, caption):
    calls = []
    monkeypatch.setattr(extractor, "resolve_school_timezone", lambda _: "America/Toronto")
    monkeypatch.setattr(extractor, "current_semester_end", lambda *args, **kwargs: None)
    payload = {
        "content_type": "event_and_hiring",
        "events": [{"title": "Workshop", "school": "wrong-school"}],
        "positions": [{"title": "Designer", "position_type": "committee"}],
    }
    if not caption or not caption.strip():
        for items in (payload["events"], payload["positions"]):
            items[0]["description"] = "Details read from the image."

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))]
        )

    monkeypatch.setattr(
        extractor,
        "_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
    )
    result = extractor.extract_post_content(
        caption_text=caption,
        image_urls=["https://example.com/image.jpg"],
        post_created_at=None,
        school=" UTSG ",
    )

    expected = caption if caption and caption.strip() else "Details read from the image."
    assert result.events[0]["description"] == expected
    assert (
        result.positions[0]["description"] == expected[: extractor.MAX_POSITION_DESCRIPTION_LENGTH]
    )
    assert result.events[0]["school"] == "utsg"
    content = calls[0]["messages"][1]["content"]
    prompt = content[0]["text"]
    assert "Campus context: utsg." in prompt
    assert "takes precedence over campus context" in prompt
    assert "Never rename a host to match campus context" in prompt
    assert ('"description": string' in prompt) == (not caption or not caption.strip())
    assert '"school": string' not in prompt
    assert "https://example.com/image.jpg" not in prompt
    assert content[1] == {"type": "text", "text": "Image 0:"}
    assert content[2]["image_url"]["url"] == "https://example.com/image.jpg"


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
            source_club="Alma Mater Society of UBC",
        )
        == []
    )

    prompt = calls[0]["messages"][1]["content"][0]["text"]
    assert "Campus context: ubc." in prompt
    assert "Campus context: University of British Columbia" not in prompt
    assert '"content_type": "event" | "hiring"' in prompt
    assert '"positions": [' in prompt
    assert "OFFICIAL DIRECTORY PUBLISHER:" in prompt
    assert "published by Alma Mater Society of UBC" in prompt
    assert "unless the page explicitly identifies a distinct student club" in prompt
    assert "Never invent a club from an event title" in prompt


def test_extraction_prompt_has_strict_event_and_position_eligibility_gates(monkeypatch):
    calls = []
    monkeypatch.setattr(extractor, "campus_season_prompt", lambda school: f"SEASONS FOR {school}")
    monkeypatch.setattr(extractor, "resolve_school_timezone", lambda _school: "America/Toronto")
    monkeypatch.setattr(extractor, "current_semester_end", lambda *_args, **_kwargs: None)

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            message = type("Message", (), {"content": '{"content_type":"other"}'})()
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

    extractor.extract_post_content(
        caption_text=(
            "F26 Exec Elections start today. Read the candidates' speeches and vote for "
            "Treasurer, Assistant Events Leader, and Marketing Media and Design Manager."
        ),
        image_urls=[],
        post_created_at=None,
        school="uwaterloo",
    )

    prompt = calls[0]["messages"][1]["content"][0]["text"]
    assert "SEASONS FOR uwaterloo" in prompt
    assert "POSITION ELIGIBILITY GATE (CRITICAL):" in prompt
    assert "Election voting posts are not hiring." in prompt
    assert "Candidate lists or slates" in prompt
    assert "invitations to run for elected office are not hiring" in prompt
    assert "Closure notices, holiday hours" in prompt
    assert "EXPLICIT RECURRING SCHEDULES:" in prompt
    assert "Do NOT infer or compress recurrence patterns" not in prompt
    assert "daylight-saving" in prompt
    assert "current-board rosters" in prompt
    assert "generic club membership" in prompt
    assert "independently pass BOTH tests" in prompt
    assert "ROLE TEST:" in prompt
    assert "OPENING TEST:" in prompt
    assert "Mentors and mentees joining a peer-mentorship program" in prompt
    assert "Do not relabel a program as an internship" in prompt
    assert "competitive-team members joining through auditions" in prompt
    assert "One-off event helpers" in prompt
    assert 'Omit ineligible entries such as "General Members"' in prompt
    assert "ticket or registration release" in prompt
    assert "a program reveal" in prompt
    assert "one object per logical event" in prompt
    assert extractor.EVENT_DISCOVERY_RULES in prompt
    assert "official school varsity team" in prompt
    assert "Intramural, club-team, and recreational competitions, practices, tryouts" in prompt
    assert "watch parties do not qualify" in prompt
    assert "Use null when official varsity participation is unconfirmed" in prompt
    for name in extractor.EventDiscoveryFields.model_fields:
        kind = "string[]" if name == "campus_season_ids" else "boolean"
        assert f'"{name}": {kind} or null' in prompt
    assert 'Use ["Food"] for a generic food mention.' in prompt
    assert 'Never return "Yes" or "Yes!" as a food label.' in prompt
    assert '"Executive elections start today. Read the candidate speeches and vote' in prompt
    assert '"Nominations are open. Apply or run for Treasurer by Friday"' in prompt
    assert '"Meet this year\'s Merch Coordinator" is "other"' in prompt
    assert '"Apply to be a mentor or mentee in our peer mentorship program"' in prompt
    assert '"Applications are open for our eight-week equity research training program"' in prompt
    assert '"Volunteers needed for our Welcome Week events; sign up below"' in prompt
    assert '"Try out for our varsity esports team"' in prompt


@pytest.mark.live_llm
@pytest.mark.skipif(not extractor.settings.openai_api_key, reason="OPENAI_API_KEY not configured")
@pytest.mark.parametrize(
    ("caption", "semester_end", "expected_dates"),
    [
        pytest.param(
            "Stocks Club, University of Waterloo. JOIN OUR FIRST MEETING, FALL 2026. "
            "First Meeting: Tuesday, September 29th at 6:00 PM-7:00 PM in MC 4045. "
            "Weekly Meetings: Tuesdays at 6:00 PM-7:00 PM in MC 4045.",
            "20261222T235959Z",
            [
                "2026-09-29",
                "2026-10-06",
                "2026-10-13",
                "2026-10-20",
                "2026-10-27",
                "2026-11-03",
                "2026-11-10",
                "2026-11-17",
                "2026-11-24",
                "2026-12-01",
                "2026-12-08",
                "2026-12-15",
                "2026-12-22",
            ],
            id="stocks-club-poster-transcript-includes-future-weeks-and-dst",
        ),
        pytest.param(
            "Join our study sessions in MC 4045 every Monday and Thursday, "
            "October 5-16, 2026, 6-7 PM. No session October 12. RSVP by October 1.",
            "20261222T235959Z",
            ["2026-10-05", "2026-10-08", "2026-10-15"],
            id="bounded-multiple-weekdays-with-exclusion-and-rsvp",
        ),
        pytest.param(
            "Join our four investing workshops, every other Tuesday starting "
            "October 20, 2026, 6-7 PM in MC 4045.",
            "20261222T235959Z",
            ["2026-10-20", "2026-11-03", "2026-11-17", "2026-12-01"],
            id="fortnightly-schedule-with-explicit-count",
        ),
        pytest.param(
            "Join Stocks Club for our first meeting of Fall 2026 on "
            "September 29, 6-7 PM in MC 4045.",
            "20261222T235959Z",
            ["2026-09-29"],
            id="first-meeting-alone-does-not-imply-recurrence",
        ),
        pytest.param(
            "Join our weekly investing meetings this term, every Tuesday 6-7 PM in MC 4045.",
            "20261013T235959Z",
            ["2026-09-29", "2026-10-06", "2026-10-13"],
            id="weekday-schedule-anchors-to-post-date",
        ),
        pytest.param(
            "Join our investing meetings starting September 29, 2026, "
            "every Tuesday 6-7 PM in MC 4045.",
            None,
            ["2026-09-29"],
            id="no-invented-horizon-without-semester-context",
        ),
        pytest.param(
            "Stocks Club Fall 2025 meetings. First meeting September 30, 2025, "
            "then every Tuesday 6-7 PM in MC 4045.",
            "20261222T235959Z",
            ["2025-09-30"],
            id="old-term-series-does-not-extend-into-current-term",
        ),
    ],
)
def test_live_extraction_expands_only_advertised_recurrence(
    monkeypatch, caption, semester_end, expected_dates
):
    """Exercise the real prompt/model/parser with a frozen academic context."""
    local_tz = ZoneInfo("America/Toronto")

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 9, 28, 12, tzinfo=local_tz).astimezone(tz)

    monkeypatch.setattr(extractor, "datetime", FrozenDatetime)
    monkeypatch.setattr(extractor, "resolve_school_timezone", lambda _: local_tz.key)
    monkeypatch.setattr(extractor, "current_semester_end", lambda *args, **kwargs: semester_end)
    result = extractor.extract_post_content(
        caption_text=caption,
        image_urls=[],
        post_created_at=FrozenDatetime(2026, 9, 23, 12, tzinfo=local_tz),
        school="uwaterloo",
    )

    assert result.content_type == "event"
    assert len(result.events) == 1
    occurrences = result.events[0]["occurrences"]
    assert [occurrence["dtstart_utc"] for occurrence in occurrences] == [
        datetime.fromisoformat(f"{day}T18:00:00")
        .replace(tzinfo=local_tz)
        .astimezone(ZoneInfo("UTC"))
        .strftime("%Y-%m-%dT%H:%M:%SZ")
        for day in expected_dates
    ]
    assert [occurrence["dtend_utc"] for occurrence in occurrences] == [
        datetime.fromisoformat(f"{day}T19:00:00")
        .replace(tzinfo=local_tz)
        .astimezone(ZoneInfo("UTC"))
        .strftime("%Y-%m-%dT%H:%M:%SZ")
        for day in expected_dates
    ]
    assert all(occurrence["tz"] == local_tz.key for occurrence in occurrences)


def test_clean_extracted_content_triages_hiring_positions():
    result = _clean_extracted_content(
        {
            "content_type": "hiring",
            "events": [],
            "positions": [
                {
                    "title": "Design Lead",
                    "description": "Lead the club's visual design work.",
                    "club": "UW Design Club",
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


@pytest.mark.parametrize("price", [None, 0, 15])
def test_clean_event_free_food_does_not_determine_admission_price(price):
    cleaned = _clean_event(
        {
            "title": "Free Pizza Friday",
            "description": "Free pizza on campus",
            "food": ["Free pizza"],
            "free_food_on_campus": True,
            "price": price,
        }
    )
    assert cleaned["price"] == price
    assert cleaned["free_food_on_campus"] is True


@pytest.mark.parametrize("value", [True, False, None])
def test_clean_event_preserves_discovery_evidence(value):
    facts = dict.fromkeys(("employers_on_campus", "free_food_on_campus", "sports_game"), value)
    cleaned = _clean_event({"title": "Campus event", **facts})
    assert {name: cleaned[name] for name in facts} == facts


def test_clean_event_does_not_guess_discovery_metadata_from_category_or_food():
    cleaned = _clean_event({"title": "Career fair", "food": ["Pizza"], "price": 0})
    assert all(cleaned[name] is None for name in extractor.EventDiscoveryFields.model_fields)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ([], []),
        (["hoco", "hoco", "finals-prep"], ["finals-prep", "hoco"]),
        (["other-school", "hoco", 7, None], ["hoco"]),
        (["other-school"], None),
        ("hoco", None),
        (True, None),
        ({"hoco": True}, None),
    ],
)
def test_clean_event_filters_invalid_season_metadata_without_losing_event(
    monkeypatch, value, expected
):
    from services import school_service

    monkeypatch.setattr(
        school_service,
        "campus_season_ids",
        lambda school: frozenset({"hoco", "finals-prep"}) if school == "uwaterloo" else frozenset(),
    )
    event = _clean_event({"title": "Review", "school": "uwaterloo", "campus_season_ids": value})
    assert event["title"] == "Review"
    assert event["campus_season_ids"] == expected


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


def test_clean_event_decodes_serialized_caption_text():
    cleaned = _clean_event(
        {
            "title": "Review session",
            "description": r"\ud83d\udcca Study together\n\nBring questions.",
        }
    )

    assert cleaned["description"] == "📊 Study together\n\nBring questions."


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


def test_clean_position_decodes_serialized_text_fields():
    cleaned = _clean_position(
        {
            "title": "Design Lead",
            "description": r"Create posters \u2728",
            "position_type": "committee",
            "requirements": [r"Portfolio\nrequired"],
        }
    )

    assert cleaned["description"] == "Create posters ✨"
    assert cleaned["requirements"] == ["Portfolio\nrequired"]
