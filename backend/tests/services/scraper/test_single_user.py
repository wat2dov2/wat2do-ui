"""Tests for single-user scrape helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from schemas.school import School
from services.scraper import single_user
from services.scraper.single_user import (
    SchoolResolutionError,
    fetch_posts_for_single_user,
    filter_valid_posts,
    is_post_url_target,
    resolve_single_user_handle,
    resolve_single_user_scrape_school,
)


def _school(slug: str) -> School:
    return School(
        slug=slug,
        name=slug,
        primary_color="#FFD54F",
        secondary_color="#111111",
        timezone="America/Toronto",
    )


def test_resolve_single_user_scrape_school_waterloo(monkeypatch):
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "76214170483")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_recipient_id",
        MagicMock(return_value=_school("uwaterloo")),
    )
    assert resolve_single_user_scrape_school() == "uwaterloo"


def test_resolve_single_user_scrape_school_utm(monkeypatch):
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "78383689040")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_recipient_id",
        MagicMock(return_value=_school("utm")),
    )
    assert resolve_single_user_scrape_school() == "utm"


def test_resolve_single_user_scrape_school_requires_recipient_id_or_target_school(monkeypatch):
    monkeypatch.delenv("INTENDED_RECIPIENT_ID", raising=False)
    monkeypatch.delenv("TARGET_SCHOOL", raising=False)
    with pytest.raises(
        SchoolResolutionError, match="Either INTENDED_RECIPIENT_ID or TARGET_SCHOOL is required"
    ):
        resolve_single_user_scrape_school()


def test_resolve_single_user_scrape_school_rejects_unknown_recipient_id(monkeypatch):
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "99999999999")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_recipient_id",
        MagicMock(return_value=None),
    )
    with pytest.raises(SchoolResolutionError, match="No school mapping in DB"):
        resolve_single_user_scrape_school()


def test_resolve_single_user_scrape_school_prefers_recipient_id_over_target_school(monkeypatch):
    monkeypatch.setenv("TARGET_SCHOOL", "McGill University")
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "76214170483")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_recipient_id",
        MagicMock(return_value=_school("uwaterloo")),
    )
    # Ensure get_school is not called when recipient_id is present
    mock_get_school = MagicMock()
    monkeypatch.setattr(single_user.school_service, "get_school", mock_get_school)
    assert resolve_single_user_scrape_school() == "uwaterloo"
    assert not mock_get_school.called


def test_resolve_single_user_scrape_school_falls_back_to_target_school_name(monkeypatch):
    monkeypatch.delenv("INTENDED_RECIPIENT_ID", raising=False)
    monkeypatch.setenv("TARGET_SCHOOL", "University of Waterloo")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school",
        MagicMock(return_value=None),
    )
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_name",
        MagicMock(return_value=_school("uwaterloo")),
    )
    assert resolve_single_user_scrape_school() == "uwaterloo"


def test_resolve_single_user_scrape_school_falls_back_to_target_school_slug(monkeypatch):
    monkeypatch.delenv("INTENDED_RECIPIENT_ID", raising=False)
    monkeypatch.setenv("TARGET_SCHOOL", "utm")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school",
        MagicMock(return_value=_school("utm")),
    )
    # Ensure get_school_by_name is not called when found by slug
    mock_get_school_by_name = MagicMock()
    monkeypatch.setattr(single_user.school_service, "get_school_by_name", mock_get_school_by_name)
    assert resolve_single_user_scrape_school() == "utm"
    assert not mock_get_school_by_name.called


def test_resolve_single_user_scrape_school_rejects_unknown_target_school(monkeypatch):
    monkeypatch.delenv("INTENDED_RECIPIENT_ID", raising=False)
    monkeypatch.setenv("TARGET_SCHOOL", "Unknown School")
    monkeypatch.setattr(
        single_user.school_service,
        "get_school",
        MagicMock(return_value=None),
    )
    monkeypatch.setattr(
        single_user.school_service,
        "get_school_by_name",
        MagicMock(return_value=None),
    )
    with pytest.raises(
        SchoolResolutionError, match="Could not resolve school slug from target_school"
    ):
        resolve_single_user_scrape_school()


def test_is_post_url_target():
    assert is_post_url_target("https://www.instagram.com/p/ABC123/")
    assert not is_post_url_target("uwteaorganization")


def test_filter_valid_posts_keeps_real_posts():
    posts = [
        {"url": "https://www.instagram.com/p/GOOD/"},
        {"url": "https://www.instagram.com/uwteaorganization"},
        {"url": "https://www.instagram.com/p/BAD/", "error": "not found"},
        {"errorDescription": "blocked"},
    ]
    assert filter_valid_posts(posts) == [{"url": "https://www.instagram.com/p/GOOD/"}]


def test_resolve_single_user_handle_from_post_owner():
    posts = [{"ownerUsername": "club_page", "url": "https://www.instagram.com/p/X/"}]
    assert (
        resolve_single_user_handle(
            target="https://www.instagram.com/p/X/",
            posts=posts,
        )
        == "club_page"
    )


def test_resolve_single_user_handle_keeps_username():
    assert resolve_single_user_handle(target="uwteaorganization", posts=[]) == "uwteaorganization"


def test_fetch_posts_for_single_user_uses_recent_post_without_refetch():
    scraper = MagicMock()
    recent = datetime.now(timezone.utc) - timedelta(minutes=5)
    scraper.scrape.return_value = (
        [{"url": "https://instagram.com/p/A/", "timestamp": recent.isoformat()}],
        False,
    )

    posts, pinned = fetch_posts_for_single_user(
        "uwteaorganization",
        cutoff_days=1,
        scraper=scraper,
    )

    assert len(posts) == 1
    assert pinned is False
    scraper.scrape.assert_called_once()


def test_fetch_posts_for_single_user_refetches_when_stale():
    scraper = MagicMock()
    stale = datetime.now(timezone.utc) - timedelta(hours=2)
    fresh = datetime.now(timezone.utc) - timedelta(minutes=10)
    scraper.scrape.side_effect = [
        ([{"url": "https://instagram.com/p/OLD/", "timestamp": stale.isoformat()}], False),
        (
            [
                {"url": "https://instagram.com/p/OLD/", "timestamp": stale.isoformat()},
                {"url": "https://instagram.com/p/NEW/", "timestamp": fresh.isoformat()},
            ],
            False,
        ),
    ]

    posts, _pinned = fetch_posts_for_single_user(
        "uwteaorganization",
        cutoff_days=1,
        scraper=scraper,
    )

    assert scraper.scrape.call_count == 2
    assert posts[0]["url"].endswith("NEW/")


def test_fetch_posts_for_single_user_skips_recency_for_post_url():
    scraper = MagicMock()
    stale = datetime.now(timezone.utc) - timedelta(hours=2)
    scraper.scrape.return_value = (
        [{"url": "https://instagram.com/p/DIRECT/", "timestamp": stale.isoformat()}],
        False,
    )

    posts, _pinned = fetch_posts_for_single_user(
        "https://www.instagram.com/p/DIRECT/",
        cutoff_days=1,
        scraper=scraper,
    )

    assert len(posts) == 1
    scraper.scrape.assert_called_once()
