"""Unit tests for services/wat2do/school_dates."""

from datetime import datetime

import pytest

from services.scraper.school_dates import current_semester_end, resolve_school_timezone


def test_resolve_school_timezone_us_schools():
    """The Phase 1 audit added UPenn/NYU/Columbia/MIT — confirm they map."""
    assert resolve_school_timezone("University of Pennsylvania") == "America/New_York"
    assert resolve_school_timezone("New York University") == "America/New_York"
    assert resolve_school_timezone("Columbia University") == "America/New_York"
    assert resolve_school_timezone("Massachusetts Institute of Technology") == "America/New_York"


def test_resolve_school_timezone_aliases():
    """Aliases (uw, mit, nyu, upenn, penn, columbia) all canonicalise."""
    assert resolve_school_timezone("upenn") == "America/New_York"
    assert resolve_school_timezone("penn") == "America/New_York"
    assert resolve_school_timezone("mit") == "America/New_York"
    assert resolve_school_timezone("nyu") == "America/New_York"
    assert resolve_school_timezone("columbia") == "America/New_York"


def test_current_semester_end_winter():
    """January–April -> winter/spring index."""
    spring = datetime(2026, 3, 15)
    assert current_semester_end("University of Waterloo", now=spring) == "20260430T235959Z"
    # UPenn winter ends May 31, not April 30 — confirm the per-school table
    # is being indexed correctly.
    assert current_semester_end("University of Pennsylvania", now=spring) == "20260531T235959Z"


def test_current_semester_end_summer():
    """May–August -> summer index, identical across schools."""
    summer = datetime(2026, 6, 15)
    for school in (
        "University of Waterloo",
        "University of Pennsylvania",
        "Massachusetts Institute of Technology",
    ):
        assert current_semester_end(school, now=summer) == "20260831T235959Z"


def test_current_semester_end_fall():
    """September–December -> fall index, December 31 across all schools."""
    fall = datetime(2026, 10, 1)
    for school in ("University of Waterloo", "Columbia University", "New York University"):
        assert current_semester_end(school, now=fall) == "20251231T235959Z"


def test_current_semester_end_unknown_school_returns_none():
    """Unknown schools return None so the prompt skips the semester anchor."""
    assert current_semester_end("Hogwarts", now=datetime(2026, 5, 1)) is None
    assert current_semester_end(None) is None
    assert current_semester_end("") is None


@pytest.mark.parametrize(
    "school",
    [
        "University of Waterloo",
        "Wilfrid Laurier University",
        "University of Guelph",
        "Conestoga College",
    ],
)
def test_current_semester_end_canadian_schools_have_data(school):
    """Existing Canadian schools must remain mapped (no regression on the legacy 4)."""
    assert current_semester_end(school, now=datetime(2026, 3, 1)) == "20260430T235959Z"
