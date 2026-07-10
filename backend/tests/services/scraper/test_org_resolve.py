"""Unit tests for scrape organization resolution."""

from services.scraper import org_resolve
from services.scraper.org_resolve import ResolvedOrganization, resolve_organization_for_scrape


def test_resolve_by_ig_uses_ensure(monkeypatch):
    monkeypatch.setattr(
        org_resolve.event_writer_mod,
        "_ensure_organization_by_ig",
        lambda handle, school=None, preferred_name=None: {
            "id": 7,
            "organization_name": "UW Tea Organization",
            "organization_type": "Independent",
        },
    )

    result = resolve_organization_for_scrape(
        ig_handle="@uwtea",
        school="uwaterloo",
        organization_name="Ignored",
        create_stub_if_missing=True,
    )
    assert result == ResolvedOrganization(
        organization_id=7,
        organization_name="UW Tea Organization",
        organization_type="Independent",
        ig_handle="uwtea",
    )


def test_resolve_by_school_and_name_no_stub(monkeypatch):
    monkeypatch.setattr(
        org_resolve.organization_service,
        "lookup_organization_by_school_and_name",
        lambda school, name: {
            "id": 3,
            "organization_name": "UW Tea Organization",
            "organization_type": "Independent",
            "ig": "uwtea",
            "school": school,
        },
    )

    result = resolve_organization_for_scrape(
        ig_handle=None,
        school="uwaterloo",
        organization_name="UW Tea Organization",
        create_stub_if_missing=False,
    )
    assert result.organization_id == 3
    assert result.ig_handle == "uwtea"


def test_resolve_directory_miss_leaves_org_null(monkeypatch):
    monkeypatch.setattr(
        org_resolve.organization_service,
        "lookup_organization_by_school_and_name",
        lambda school, name: None,
    )

    result = resolve_organization_for_scrape(
        ig_handle=None,
        school="uwaterloo",
        organization_name="Noisy Directory Name",
        create_stub_if_missing=False,
    )
    assert result.organization_id is None
    assert result.organization_name == "Noisy Directory Name"
    assert result.ig_handle is None
