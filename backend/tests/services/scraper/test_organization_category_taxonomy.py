"""Tests for directory -> canonical organization category mapping."""

from core.constants.organizations import ORGANIZATION_CATEGORIES
from services.scraper.organization_category_taxonomy import (
    map_directory_category_field,
    map_directory_category_list,
)


def test_maps_legacy_app_tags():
    assert map_directory_category_list("Academic, Technology") == [
        "Political and Social Awareness",
        "Media, Publications and Web Development",
    ]


def test_maps_nyu_style_multi_tag_field():
    result = map_directory_category_list("Culture & Identity-Based, Social")
    assert "Creative Arts, Dance and Music" in result
    assert "Games, Recreational and Social" in result


def test_unmappable_directory_metadata_returns_empty():
    assert map_directory_category_field("Undergrad Independent (EO) Org") == ""
    assert map_directory_category_field("Unknown") == ""


def test_output_is_canonical_only():
    samples = [
        "Academic",
        "religion-culture-clubs",
        "Community Engagement & Service, Performance & Arts",
        "charity-environment-clubs",
    ]
    for sample in samples:
        for category in map_directory_category_list(sample):
            assert category in ORGANIZATION_CATEGORIES
