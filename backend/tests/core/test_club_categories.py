"""Tests for club category normalization."""

import pytest

from core.constants import CLUB_CATEGORIES
from schemas.club import ClubCreate, normalize_club_category


class TestNormalizeClubCategory:
    def test_accepts_canonical_category(self):
        sample = CLUB_CATEGORIES[0]
        assert normalize_club_category(sample) == sample

    def test_rejects_unknown_category(self):
        assert normalize_club_category("NotACategory") is None


class TestClubCreateCategoryValidation:
    def test_rejects_invalid_categories(self):
        with pytest.raises(ValueError, match="categories must be from"):
            ClubCreate(
                club_name="Test Org",
                club_type="wusa",
                categories=["NotACategory"],
            )

    def test_accepts_canonical_categories(self):
        club = ClubCreate(
            club_name="Test Org",
            club_type="wusa",
            categories=[CLUB_CATEGORIES[0]],
        )
        assert club.categories == [CLUB_CATEGORIES[0]]


def test_club_type_normalizes_to_signature_slug():
    club = ClubCreate(
        club_name="Test Org",
        club_type="  WUSA  ",
    )

    assert club.club_type == "wusa"


def test_club_type_rejects_non_slug_values():
    with pytest.raises(ValueError):
        ClubCreate(
            club_name="Test Org",
            club_type="Waterloo Association",
        )
