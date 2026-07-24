"""Tests for organization category normalization."""

import pytest

from core.constants import ORGANIZATION_CATEGORIES
from schemas.organization import OrganizationCreate, normalize_organization_category


class TestNormalizeOrganizationCategory:
    def test_accepts_canonical_category(self):
        sample = ORGANIZATION_CATEGORIES[0]
        assert normalize_organization_category(sample) == sample

    def test_rejects_unknown_category(self):
        assert normalize_organization_category("NotACategory") is None


class TestOrganizationCreateCategoryValidation:
    def test_rejects_invalid_categories(self):
        with pytest.raises(ValueError, match="categories must be from"):
            OrganizationCreate(
                organization_name="Test Org",
                organization_type="wusa",
                categories=["NotACategory"],
            )

    def test_accepts_canonical_categories(self):
        organization = OrganizationCreate(
            organization_name="Test Org",
            organization_type="wusa",
            categories=[ORGANIZATION_CATEGORIES[0]],
        )
        assert organization.categories == [ORGANIZATION_CATEGORIES[0]]


def test_organization_type_normalizes_to_signature_slug():
    organization = OrganizationCreate(
        organization_name="Test Org",
        organization_type="  WUSA  ",
    )

    assert organization.organization_type == "wusa"


def test_organization_type_rejects_non_slug_values():
    with pytest.raises(ValueError):
        OrganizationCreate(
            organization_name="Test Org",
            organization_type="Waterloo Association",
        )
