"""Unit tests for shared school context helpers."""

from datetime import datetime

from services import school_context


def test_canonical_school_key_normalizes_waterloo_aliases_and_blank_values():
    assert school_context.canonical_school_key("  UW  ") == "uwaterloo"
    assert school_context.canonical_school_key(None) == ""
    assert school_context.canonical_school_key("   ") == ""


def test_resolve_school_timezone_handles_full_names_and_unknown_fallback():
    assert school_context.resolve_school_timezone("University of Waterloo") == "America/Toronto"
    assert school_context.resolve_school_timezone("University of Pennsylvania") == "UTC"
    assert school_context.resolve_school_timezone("Unknown University") == "UTC"
    assert school_context.resolve_school_timezone(None) == "UTC"


def test_school_for_user_uses_stored_school():
    user = {
        "id": "user-1",
        "email": "alice@uwaterloo.ca",
        "school": "Massachusetts Institute of Technology",
    }

    assert school_context.school_for_user(user) == "Massachusetts Institute of Technology"


def test_school_for_user_falls_back_to_explicit_school():
    user = {
        "id": "user-1",
        "email": "person@example.edu",
        "school": "  University of Pennsylvania  ",
    }

    assert school_context.school_for_user(user) == "University of Pennsylvania"


def test_resolve_user_timezone_uses_school_context_with_utc_fallback():
    assert (
        school_context.resolve_user_timezone(
            {"id": "user-1", "email": "person@example.edu", "school": "New York University"}
        ).key
        == "UTC"
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
            "University of Waterloo",
            now=datetime(2026, 3, 15),
        )
        == "20260430T235959Z"
    )
    assert (
        school_context.current_semester_end("University of Pennsylvania", now=datetime(2026, 3, 15))
        is None
    )
    assert school_context.current_semester_end("Unknown", now=datetime(2026, 5, 1)) is None
