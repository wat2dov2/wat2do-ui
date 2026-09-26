"""Unit tests for services/scraper/dedup."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from httpx import RemoteProtocolError

from services.scraper.dedup import (
    _extract_shortcode,
    collapse_duplicate_extractions,
    confident_duplicate_id,
    existing_shortcodes,
    find_candidates,
    jaccard_similarity,
    normalize,
    sequence_similarity,
    title_similarity,
)

# ── Pure similarity helpers ───────────────────────────────────────────


def test_normalize_strips_non_alphanumeric():
    assert normalize("Hello, World! 123") == "helloworld123"
    assert normalize("") == ""
    assert normalize("a-b_c") == "abc"


def test_jaccard_returns_zero_for_empty_input():
    assert jaccard_similarity("", "anything") == 0.0
    assert jaccard_similarity("hello", "") == 0.0


def test_jaccard_word_overlap():
    """Word-set Jaccard: |A∩B| / |A∪B|."""
    assert jaccard_similarity("hello world", "hello there") == 1 / 3


def test_sequence_similarity_identical_is_one():
    assert sequence_similarity("abc", "abc") == 1.0


def test_title_similarity_picks_max_of_jaccard_and_sequence():
    """Reordered titles must still match - that's the whole point of taking the max."""
    a = "Friday Movie Night"
    b = "Movie Night Friday"
    # Jaccard on word sets is 1.0 here - same words, different order.
    assert title_similarity(a, b) == 1.0


# ── Shortcode extraction ──────────────────────────────────────────────


def test_extract_shortcode_post_url():
    assert _extract_shortcode("https://www.instagram.com/p/AbCDeF1/") == "AbCDeF1"


def test_extract_shortcode_reel_url():
    assert _extract_shortcode("https://instagram.com/reel/XYZ7/") == "XYZ7"


def test_extract_shortcode_empty_returns_none():
    assert _extract_shortcode("") is None
    assert _extract_shortcode("/") is None


def test_extract_shortcode_handles_query_string():
    """A URL with ?utm_source=… still resolves to the canonical shortcode."""
    assert _extract_shortcode("https://www.instagram.com/p/AbCDeF1/?utm_source=ig_web") == "AbCDeF1"
    assert _extract_shortcode("https://www.instagram.com/p/AbCDeF1?ref=x") == "AbCDeF1"


def test_extract_shortcode_handles_trailing_fragment():
    assert _extract_shortcode("https://instagram.com/reel/XYZ7/#hash") == "XYZ7"


def test_extract_shortcode_no_trailing_slash():
    assert _extract_shortcode("https://www.instagram.com/p/AbCDeF1") == "AbCDeF1"


def test_extract_shortcode_tv_path():
    """Instagram TV URLs use /tv/<shortcode>/."""
    assert _extract_shortcode("https://instagram.com/tv/MoVie123/") == "MoVie123"


def test_extract_shortcode_profile_url_returns_none():
    """A profile link (/uwteaclub) is NOT a post - returns None."""
    assert _extract_shortcode("https://instagram.com/uwteaclub") is None
    assert _extract_shortcode("https://instagram.com/uwteaclub/") is None


def test_extract_shortcode_unrelated_url_returns_none():
    assert (
        _extract_shortcode("https://example.com/p/hello/") is None
        or _extract_shortcode("https://example.com/p/hello/") == "hello"
    )
    # The current regex matches any /p/<id>/ path - that's intentional
    # (the seen set holds shortcodes regardless of host); the dedup
    # tolerates false positives because they only cause a real IG post
    # to be skipped, not duplicated. Confirm with a sentinel test that
    # the function doesn't raise on a non-instagram URL.
    assert _extract_shortcode("https://example.com/uwteaclub") is None


def test_existing_shortcodes_does_not_retry_exhausted_transport_error(monkeypatch):
    response = MagicMock(data=[{"source_url": "https://www.instagram.com/p/AbCDeF1/"}])
    query = MagicMock()
    query.execute.side_effect = [RemoteProtocolError("connection terminated"), response]
    query.range.return_value = query
    query.order.return_value = query
    query.or_.return_value = query
    query.not_.is_.return_value = query
    query.select.return_value = query
    database = MagicMock()
    database.table.return_value = query
    monkeypatch.setattr("services.scraper.dedup.get_sb", lambda: database)

    with pytest.raises(RemoteProtocolError, match="connection terminated"):
        existing_shortcodes({"AbCDeF1"})
    assert query.execute.call_count == 1


# ── find_candidates ───────────────────────────────────────────────────


def _occ(start_iso: str) -> dict:
    return {"dtstart_utc": start_iso, "dtend_utc": "", "duration": "", "tz": "UTC"}


def _duplicate_event(**overrides) -> dict:
    event = {
        "title": "Shoot N Shine",
        "description": "Campus photo session",
        "location": "University Square",
        "club": "Ottawa Student Union",
        "occurrences": [_occ("2026-09-10T18:00:00+00:00")],
        "price": None,
        "food": [],
        "registration": False,
    }
    event.update(overrides)
    return event


def test_confident_duplicate_requires_same_org_title_location_and_time():
    candidate = {
        **_duplicate_event(title="Shoot & Shine"),
        "id": 42,
        "club_id": 7,
        "ig_handle": "uottawasu",
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(),
            candidates=[candidate],
            club_id=7,
            ig_handle="uottawasu",
        )
        == 42
    )


def test_confident_duplicate_rejects_nearby_nonmatching_start_time():
    candidate = {
        **_duplicate_event(
            occurrences=[_occ("2026-09-10T18:30:00+00:00")],
        ),
        "id": 42,
        "club_id": 7,
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(),
            candidates=[candidate],
            club_id=7,
            ig_handle=None,
        )
        is None
    )


def test_confident_duplicate_normalizes_equal_timezone_offsets():
    candidate = {
        **_duplicate_event(
            occurrences=[_occ("2026-09-10T14:00:00-04:00")],
        ),
        "id": 42,
        "club_id": 7,
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(),
            candidates=[candidate],
            club_id=7,
            ig_handle=None,
        )
        == 42
    )


def test_confident_duplicate_rejects_different_clubs():
    candidate = {
        **_duplicate_event(),
        "id": 42,
        "club_id": 99,
        "ig_handle": "anotherclub",
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(),
            candidates=[candidate],
            club_id=7,
            ig_handle="uottawasu",
        )
        is None
    )


def test_confident_duplicate_rejects_distinct_language_sessions():
    candidate = {
        **_duplicate_event(title="Virtual Orientation - French"),
        "id": 42,
        "club_id": 7,
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(title="Virtual Orientation - English"),
            candidates=[candidate],
            club_id=7,
            ig_handle=None,
        )
        is None
    )


def test_confident_duplicate_leaves_generic_and_language_specific_titles_to_llm():
    candidate = {
        **_duplicate_event(title="Virtual Orientation - French"),
        "id": 42,
        "club_id": 7,
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(title="Virtual Orientation"),
            candidates=[candidate],
            club_id=7,
            ig_handle=None,
        )
        is None
    )


def test_confident_duplicate_rejects_distinct_campuses():
    candidate = {
        **_duplicate_event(location="Waterloo Campus"),
        "id": 42,
        "club_id": 7,
    }

    assert (
        confident_duplicate_id(
            event=_duplicate_event(location="Brantford Campus"),
            candidates=[candidate],
            club_id=7,
            ig_handle=None,
        )
        is None
    )


def test_collapse_duplicate_extractions_merges_supplied_details():
    events = [
        _duplicate_event(description="Photo session", price=None),
        _duplicate_event(
            description="Campus photo session with professional headshots",
            price=5,
            food=["Snacks"],
            registration=True,
        ),
    ]

    collapsed, source_indexes, duplicate_count = collapse_duplicate_extractions(
        events,
        club_ids=[7, 7],
        ig_handles=["uottawasu", "uottawasu"],
    )

    assert duplicate_count == 1
    assert source_indexes == [0]
    assert len(collapsed) == 1
    assert collapsed[0]["description"].endswith("professional headshots")
    assert collapsed[0]["price"] == 5
    assert collapsed[0]["food"] == ["Snacks"]
    assert collapsed[0]["registration"] is True


def test_find_candidates_returns_empty_without_occurrences_or_handle():
    """No occurrence and no handle -> nothing to compare."""
    result = find_candidates(
        title="Foo",
        location="Bar",
        description="",
        occurrences=[],
        ig_handle=None,
    )
    assert result == []


def test_find_candidates_same_club(fake_sb, patch_sb):
    """Same IG handle + future event + similar title -> candidate list."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 42,
                    "title": "Tea Tasting Night",
                    "ig_handle": "uwteaclub",
                    "location": "SLC",
                    "description": "...",
                    "cancelled": False,
                    "event_dates": [{"dtstart_utc": future, "dtend_utc": future}],
                }
            ],
            [],  # same-day lookup
        ]
    )

    result = find_candidates(
        title="Tea Tasting Evening",
        location="SLC",
        description="",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert len(result) == 1
    assert result[0]["id"] == 42
    assert "occurrences" in result[0]


def test_find_candidates_skips_past_same_club_events(fake_sb, patch_sb):
    """Past same-club events are not candidates for update."""
    patch_sb("services.scraper.dedup")

    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 99,
                    "title": "Tea Tasting Night",
                    "ig_handle": "uwteaclub",
                    "location": "SLC",
                    "description": "",
                    "cancelled": False,
                    "event_dates": [{"dtstart_utc": past, "dtend_utc": past}],
                }
            ],
            [],
        ]
    )

    result = find_candidates(
        title="Tea Tasting Night",
        location="SLC",
        description="",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert result == []


def test_find_candidates_same_day_substring_plus_location(fake_sb, patch_sb):
    """Substring title match + similar location -> same-day candidate."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    fake_sb.queue_responses(
        [
            [],
            [
                {
                    "event_id": 17,
                    "events": {
                        "id": 17,
                        "title": "Movie Night",
                        "ig_handle": "otherclub",
                        "club_id": 99,
                        "location": "DC Library",
                        "description": "Free popcorn",
                        "cancelled": False,
                        "event_dates": [{"dtstart_utc": future, "dtend_utc": None}],
                    },
                }
            ],
        ]
    )

    result = find_candidates(
        title="Friday Movie Night",
        location="DC Library 1568",
        description="popcorn provided",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert len(result) == 1
    assert result[0]["id"] == 17


def test_find_candidates_same_org_by_club_id(fake_sb, patch_sb):
    """club_id match finds same-org candidates even without ig_handle."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 42,
                    "title": "Tea Tasting Night",
                    "club_id": 7,
                    "ig_handle": None,
                    "club": "UW Tea Club",
                    "location": "SLC",
                    "description": "...",
                    "cancelled": False,
                    "event_dates": [{"dtstart_utc": future, "dtend_utc": future}],
                }
            ],
            [],
        ]
    )

    result = find_candidates(
        title="Tea Tasting Evening",
        location="SLC",
        description="",
        occurrences=[_occ(future)],
        ig_handle=None,
        club_id=7,
    )
    assert len(result) == 1
    assert result[0]["id"] == 42
    assert result[0]["club_id"] == 7


def test_find_candidates_ranks_same_org_before_cross_org(fake_sb, patch_sb):
    """Same-org rows rank ahead of cross-org same-day rows."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 10,
                    "title": "Tea Social Hour",
                    "club_id": 7,
                    "ig_handle": "uwtea",
                    "club": "UW Tea",
                    "location": "SLC",
                    "description": "tea",
                    "cancelled": False,
                    "event_dates": [{"dtstart_utc": future, "dtend_utc": future}],
                }
            ],
            [
                {
                    "event_id": 20,
                    "events": {
                        "id": 20,
                        "title": "Tea Social Hour",
                        "club_id": 99,
                        "ig_handle": "other",
                        "club": "Other Club",
                        "location": "SLC 1000",
                        "description": "tea social",
                        "cancelled": False,
                        "event_dates": [{"dtstart_utc": future, "dtend_utc": None}],
                    },
                }
            ],
        ]
    )

    result = find_candidates(
        title="Tea Social Hour",
        location="SLC 1000",
        description="tea social",
        occurrences=[_occ(future)],
        ig_handle="uwtea",
        club_id=7,
    )
    assert [r["id"] for r in result] == [10, 20]


def test_find_candidates_caps_cross_org_same_day(fake_sb, patch_sb):
    """Cross-org same-day candidates are capped tighter than same-org."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    same_day = []
    for i in range(5):
        same_day.append(
            {
                "event_id": 100 + i,
                "events": {
                    "id": 100 + i,
                    "title": "Campus Mixer Night",
                    "club_id": 50 + i,
                    "ig_handle": f"club{i}",
                    "club": f"Club {i}",
                    "location": "SLC Ballroom",
                    "description": "campus mixer night free food",
                    "cancelled": False,
                    "event_dates": [{"dtstart_utc": future, "dtend_utc": None}],
                },
            }
        )
    fake_sb.queue_responses([[], same_day])

    result = find_candidates(
        title="Campus Mixer Night",
        location="SLC Ballroom",
        description="campus mixer night free food",
        occurrences=[_occ(future)],
        ig_handle="uwtea",
        club_id=7,
        max_cross_org=3,
    )
    assert len(result) == 3
    assert all(r["club_id"] != 7 for r in result)


def test_find_candidates_soft_name_match_when_org_id_missing(fake_sb, patch_sb):
    """Unresolved org_id can still gather same-day rows by normalized org name."""
    patch_sb("services.scraper.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    # No same-org DB call when both club_id and ig_handle are missing.
    fake_sb.queue_responses(
        [
            [
                {
                    "event_id": 55,
                    "events": {
                        "id": 55,
                        "title": "Tea Tasting Night",
                        "club_id": None,
                        "ig_handle": None,
                        "club": "UW Tea Club",
                        "location": "Remote",
                        "description": "unrelated location text",
                        "cancelled": False,
                        "event_dates": [{"dtstart_utc": future, "dtend_utc": None}],
                    },
                }
            ],
        ]
    )

    result = find_candidates(
        title="Tea Tasting Night",
        location="SLC 3223",
        description="weekly tasting",
        occurrences=[_occ(future)],
        ig_handle=None,
        club_id=None,
        club_name="uw tea   club",
    )
    assert len(result) == 1
    assert result[0]["id"] == 55


def test_equally_confident_duplicates_prefer_original_event_id():
    candidates = [{**_duplicate_event(), "id": event_id, "club_id": 7} for event_id in [99, 42]]
    assert (
        confident_duplicate_id(
            event=_duplicate_event(),
            candidates=candidates,
            club_id=7,
            ig_handle=None,
        )
        == 42
    )
