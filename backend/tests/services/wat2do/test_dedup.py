"""Unit tests for services/wat2do/dedup."""

from datetime import datetime, timedelta, timezone

from services.wat2do import dedup
from services.wat2do.dedup import (
    find_match,
    jaccard_similarity,
    normalize,
    sequence_similarity,
    title_similarity,
    _extract_shortcode,
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
    """Reordered titles must still match — that's the whole point of taking the max."""
    a = "Friday Movie Night"
    b = "Movie Night Friday"
    # Jaccard on word sets is 1.0 here — same words, different order.
    assert title_similarity(a, b) == 1.0


# ── Shortcode extraction ──────────────────────────────────────────────


def test_extract_shortcode_post_url():
    assert _extract_shortcode("https://www.instagram.com/p/AbCDeF1/") == "AbCDeF1"


def test_extract_shortcode_reel_url():
    assert _extract_shortcode("https://instagram.com/reel/XYZ7/") == "XYZ7"


def test_extract_shortcode_empty_returns_none():
    assert _extract_shortcode("") is None
    assert _extract_shortcode("/") is None


# ── find_match ────────────────────────────────────────────────────────


def _occ(start_iso: str) -> dict:
    return {"dtstart_utc": start_iso, "dtend_utc": "", "duration": "", "tz": "UTC"}


def test_find_match_returns_none_without_occurrences():
    """No occurrence -> no match (we have nothing to compare temporally)."""
    result = find_match(
        title="Foo", location="Bar", description="", occurrences=[], ig_handle="x",
    )
    assert result is None


def test_find_match_same_club_update(fake_sb, patch_sb):
    """Same IG handle + future event + similar title -> same_club match."""
    patch_sb("services.wat2do.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    fake_sb.queue_responses([
        # First query: same-club lookup — return one matching row.
        [{
            "id": 42,
            "title": "Tea Tasting Night",
            "ig_handle": "uwteaclub",
            "location": "SLC",
            "description": "...",
            "dtstart_utc": future,
            "dtend_utc": future,
        }],
    ])

    result = find_match(
        title="Tea Tasting Evening",  # similarity > 0.8
        location="SLC",
        description="",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert result is not None
    assert result.kind == "same_club"
    assert result.event["id"] == 42


def test_find_match_skips_past_same_club_events(fake_sb, patch_sb):
    """Past same-club events are NOT updates — they're new occurrences of a recurring series."""
    patch_sb("services.wat2do.dedup")

    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    fake_sb.queue_responses([
        # Same-club lookup returns past event only -> no match.
        [{
            "id": 99,
            "title": "Tea Tasting Night",
            "ig_handle": "uwteaclub",
            "location": "SLC",
            "description": "",
            "dtstart_utc": past,
            "dtend_utc": past,
        }],
        # Same-day lookup returns nothing.
        [],
    ])

    result = find_match(
        title="Tea Tasting Night",
        location="SLC",
        description="",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert result is None


def test_find_match_substring_plus_location_is_duplicate(fake_sb, patch_sb):
    """Substring title match + similar location -> cross-club duplicate."""
    patch_sb("services.wat2do.dedup")

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    fake_sb.queue_responses([
        # Same-club lookup returns nothing (different ig_handle in DB).
        [],
        # Same-day lookup returns a match.
        [{
            "id": 17,
            "title": "Movie Night",
            "ig_handle": "otherclub",
            "location": "DC Library",
            "description": "Free popcorn",
            "dtstart_utc": future,
        }],
    ])

    result = find_match(
        title="Friday Movie Night",  # contains "Movie Night"
        location="DC Library 1568",  # similar location
        description="popcorn provided",
        occurrences=[_occ(future)],
        ig_handle="uwteaclub",
    )
    assert result is not None
    assert result.kind == "duplicate"
    assert result.event["id"] == 17
