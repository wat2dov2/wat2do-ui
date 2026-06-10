"""Tests for organization category normalization."""

import pytest

from core.constants import ORGANIZATION_CATEGORIES
from schemas.club import ClubCreate, normalize_organization_category


class TestNormalizeOrganizationCategory:
    def test_accepts_canonical_category(self):
        sample = ORGANIZATION_CATEGORIES[0]
        assert normalize_organization_category(sample) == sample

    def test_rejects_unknown_category(self):
        assert normalize_organization_category("Technology") is None


class TestClubCreateCategoryValidation:
    def test_rejects_invalid_categories(self):
        with pytest.raises(ValueError, match="categories must be from"):
            ClubCreate(
                club_name="Test Org",
                club_type="WUSA",
                categories=["Technology"],
            )

    def test_accepts_canonical_categories(self):
        club = ClubCreate(
            club_name="Test Org",
            club_type="WUSA",
            categories=[ORGANIZATION_CATEGORIES[0]],
        )
        assert club.categories == [ORGANIZATION_CATEGORIES[0]]
