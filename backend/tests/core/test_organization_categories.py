"""Tests for organization category normalization."""

import pytest

from core.constants import (
    LEGACY_ORGANIZATION_CATEGORY_ALIASES,
    ORGANIZATION_CATEGORIES,
    canonicalize_organization_categories,
    canonicalize_organization_category,
)
from schemas.club import ClubCreate, normalize_organization_category


class TestCanonicalizeOrganizationCategory:
    def test_accepts_canonical_category(self):
        sample = ORGANIZATION_CATEGORIES[0]
        assert canonicalize_organization_category(sample) == sample

    def test_maps_legacy_technology_tag(self):
        assert (
            canonicalize_organization_category("Technology")
            == "Media, Publications and Web Development"
        )

    def test_rejects_unknown_category(self):
        assert canonicalize_organization_category("Undergrad Independent (EO) Org") is None

    def test_legacy_aliases_target_canonical_values(self):
        for legacy, canonical in LEGACY_ORGANIZATION_CATEGORY_ALIASES.items():
            assert canonical in ORGANIZATION_CATEGORIES
            assert canonicalize_organization_category(legacy) == canonical


class TestCanonicalizeOrganizationCategories:
    def test_deduplicates_after_legacy_mapping(self):
        assert canonicalize_organization_categories(
            ["Academic", "Technology", "Advocacy"]
        ) == [
            "Political and Social Awareness",
            "Media, Publications and Web Development",
        ]


class TestNormalizeOrganizationCategory:
    def test_delegates_to_canonicalize(self):
        assert normalize_organization_category("Social & Games") == (
            "Games, Recreational and Social"
        )


class TestClubCreateCategoryValidation:
    def test_rejects_unknown_categories(self):
        with pytest.raises(ValueError, match="categories must be from"):
            ClubCreate(
                club_name="Test Org",
                club_type="WUSA",
                categories=["Undergrad Independent (EO) Org"],
            )

    def test_accepts_legacy_categories_via_alias(self):
        club = ClubCreate(
            club_name="Test Org",
            club_type="WUSA",
            categories=["Technology", "Academic"],
        )
        assert club.categories == [
            "Media, Publications and Web Development",
            "Political and Social Awareness",
        ]

    def test_accepts_canonical_categories(self):
        club = ClubCreate(
            club_name="Test Org",
            club_type="WUSA",
            categories=[ORGANIZATION_CATEGORIES[0]],
        )
        assert club.categories == [ORGANIZATION_CATEGORIES[0]]
