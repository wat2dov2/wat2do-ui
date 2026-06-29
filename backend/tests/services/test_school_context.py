"""Unit tests for shared school context helpers."""

from datetime import datetime

from services import school_context


def test_canonical_school_key_normalizes_slug():
    assert school_context.canonical_school_key("  uwaterloo  ") == "uwaterloo"
    assert school_context.canonical_school_key(None) == ""
    assert school_context.canonical_school_key("   ") == ""


def test_resolve_school_timezone_uses_slug_only():
    assert school_context.resolve_school_timezone("uwaterloo") == "America/Toronto"
    assert school_context.resolve_school_timezone("upenn") == "America/New_York"
    assert school_context.resolve_school_timezone("University of Waterloo") == "UTC"
    assert school_context.resolve_school_timezone("Unknown") == "UTC"
    assert school_context.resolve_school_timezone(None) == "UTC"


def test_school_for_user_uses_stored_school():
    user = {
        "id": "user-1",
        "email": "alice@uwaterloo.ca",
        "school": "mit",
    }

    assert school_context.school_for_user(user) == "mit"


def test_school_for_user_falls_back_to_explicit_school():
    user = {
        "id": "user-1",
        "email": "person@example.edu",
        "school": "  upenn  ",
    }

    assert school_context.school_for_user(user) == "upenn"


def test_resolve_user_timezone_uses_school_slug_with_utc_fallback():
    assert (
        school_context.resolve_user_timezone(
            {"id": "user-1", "email": "person@example.edu", "school": "nyu"}
        ).key
        == "America/New_York"
    )
    assert (
        school_context.resolve_user_timezone(
            {"id": "user-2", "email": "person@example.edu", "school": "Unknown"}
        ).key
        == "UTC"
    )


def test_current_semester_end_uses_waterloo_only():
    assert (
        school_context.current_semester_end(
            "uwaterloo",
            now=datetime(2026, 3, 15),
        )
        == "20260430T235959Z"
    )
    assert school_context.current_semester_end("upenn", now=datetime(2026, 3, 15)) is None
    assert school_context.current_semester_end("Unknown", now=datetime(2026, 5, 1)) is None


def test_school_display_name_resolves_slug():
    assert school_context.school_display_name("uwaterloo") == "University of Waterloo"
    assert school_context.school_display_name("utm") == "University of Toronto Mississauga"
    assert school_context.school_display_name("  Unknown  ") == "unknown"
