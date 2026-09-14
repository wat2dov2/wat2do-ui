"""Unit tests for scrape club resolution."""

from services.scraper import org_resolve
from services.scraper.org_resolve import ResolvedClub, resolve_club_for_scrape


def test_resolve_by_ig_uses_ensure(monkeypatch):
    monkeypatch.setattr(
        org_resolve.event_writer_mod,
        "_lookup_club_by_ig",
        lambda handle: None,
    )
    monkeypatch.setattr(
        org_resolve.event_writer_mod,
        "_ensure_club_by_ig",
        lambda handle, school=None, preferred_name=None: {
            "id": 7,
            "club_name": "UW Tea Club",
        },
    )

    result = resolve_club_for_scrape(
        ig_handle="@uwtea",
        school="uwaterloo",
        club_name="Ignored",
        create_stub_if_missing=True,
    )
    assert result == ResolvedClub(
        club_id=7,
        club_name="UW Tea Club",
        ig_handle="uwtea",
    )


def test_resolve_by_school_and_name_no_stub(monkeypatch):
    monkeypatch.setattr(
        org_resolve.club_service,
        "lookup_club_by_school_and_name",
        lambda school, name: {
            "id": 3,
            "club_name": "UW Tea Club",
            "ig": "uwtea",
            "school": school,
        },
    )

    result = resolve_club_for_scrape(
        ig_handle=None,
        school="uwaterloo",
        club_name="UW Tea Club",
        create_stub_if_missing=False,
    )
    assert result.club_id == 3
    assert result.ig_handle == "uwtea"


def test_resolve_directory_miss_leaves_org_null(monkeypatch):
    monkeypatch.setattr(
        org_resolve.club_service,
        "lookup_club_by_school_and_name",
        lambda school, name: None,
    )

    result = resolve_club_for_scrape(
        ig_handle=None,
        school="uwaterloo",
        club_name="Noisy Directory Name",
        create_stub_if_missing=False,
    )
    assert result.club_id is None
    assert result.club_name == "Noisy Directory Name"
    assert result.ig_handle is None
