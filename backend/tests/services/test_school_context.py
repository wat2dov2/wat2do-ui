"""Unit tests for shared school context helpers."""

from datetime import datetime

import pytest

from schemas.school import School
from services import school_context


@pytest.fixture(autouse=True)
def _school_directory(monkeypatch):
    schools = {
        "uwaterloo": School(
            slug="uwaterloo",
            name="University of Waterloo",
            primary_color="#FFD54F",
            secondary_color="#111111",
            timezone="America/Toronto",
            semester_start="2026-01-01",
            semester_end="2026-04-30",
        ),
        "upenn": School(
            slug="upenn",
            name="University of Pennsylvania",
            primary_color="#011F5B",
            secondary_color="#FFFFFF",
            timezone="America/New_York",
        ),
        "dalhousie": School(
            slug="dalhousie",
            name="Dalhousie University",
            primary_color="#000000",
            secondary_color="#FFCC00",
            timezone="America/Halifax",
        ),
        "ualberta": School(
            slug="ualberta",
            name="University of Alberta",
            primary_color="#007C41",
            secondary_color="#FFDB05",
            timezone="America/Edmonton",
        ),
        "nyu": School(
            slug="nyu",
            name="New York University",
            primary_color="#57068C",
            secondary_color="#FFFFFF",
            timezone="America/New_York",
        ),
    }
    monkeypatch.setattr(
        school_context.school_service,
        "get_school",
        lambda slug: schools.get(slug),
    )


def test_canonical_school_key_normalizes_slug():
    assert school_context.canonical_school_key("  uwaterloo  ") == "uwaterloo"
    assert school_context.canonical_school_key(None) == ""
    assert school_context.canonical_school_key("   ") == ""


def test_resolve_school_timezone_uses_slug_only():
    assert school_context.resolve_school_timezone("uwaterloo") == "America/Toronto"
    assert school_context.resolve_school_timezone("upenn") == "America/New_York"
    assert school_context.resolve_school_timezone("dalhousie") == "America/Halifax"
    assert school_context.resolve_school_timezone("ualberta") == "America/Edmonton"
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
