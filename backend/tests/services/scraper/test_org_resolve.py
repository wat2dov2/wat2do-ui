"""Unit tests for scrape club resolution."""

from unittest.mock import Mock

import pytest

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


def test_cohosts_include_only_unique_existing_clubs_at_target_school(monkeypatch):
    known = {
        "owner": {"id": 7, "club_name": "Owner", "schools": {"slug": "uwaterloo"}},
        "cohost": {"id": 9, "club_name": "Cohost", "schools": {"slug": "uwaterloo"}},
        "other": {"id": 11, "club_name": "Other", "schools": {"slug": "ubc"}},
    }
    monkeypatch.setattr(org_resolve.event_writer_mod, "_lookup_club_by_ig", known.get)
    monkeypatch.setattr(
        org_resolve.event_writer_mod,
        "_ensure_club_by_ig",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not create cohosts")),
    )
    result = resolve_club_for_scrape(
        ig_handle=["@OWNER", "cohost", "cohost", "unknown", "other"],
        school="uwaterloo",
        club_name=None,
    )
    assert result.club_id == 7
    assert result.cohost_club_ids == (9,)


@pytest.mark.parametrize("handles", [["venue", "artist"], ["@Venue", "venue", "artist"]])
def test_multiple_unknown_accounts_never_create_a_club(monkeypatch, handles):
    monkeypatch.setattr(org_resolve.event_writer_mod, "_lookup_club_by_ig", lambda _: None)
    monkeypatch.setattr(org_resolve.club_service, "lookup_club_by_school_and_name", lambda *_: None)
    create = Mock()
    monkeypatch.setattr(org_resolve.event_writer_mod, "_ensure_club_by_ig", create)
    resolved = resolve_club_for_scrape(ig_handle=handles, school="uwaterloo", club_name="Artists")
    assert resolved.club_id is None
    assert resolved.ig_handle == "venue"
    create.assert_not_called()


@pytest.mark.parametrize("handles", [["venue", "artist"], ["venue"]])
def test_posts_that_cannot_create_clubs_can_link_an_existing_named_host(monkeypatch, handles):
    monkeypatch.setattr(org_resolve.event_writer_mod, "_lookup_club_by_ig", lambda _: None)
    monkeypatch.setattr(
        org_resolve.club_service,
        "lookup_club_by_school_and_name",
        lambda school, name: {"id": 6748, "club_name": name, "ig": "wloonsa"},
    )
    create = Mock()
    monkeypatch.setattr(org_resolve.event_writer_mod, "_ensure_club_by_ig", create)
    resolved = resolve_club_for_scrape(
        ig_handle=handles,
        school="uwaterloo",
        club_name="Nigerian Students Association",
        create_stub_if_missing=False,
    )
    assert resolved.club_id == 6748
    assert resolved.ig_handle == "wloonsa"
    create.assert_not_called()


def test_duplicate_account_spellings_still_allow_single_account_creation(monkeypatch):
    monkeypatch.setattr(org_resolve.event_writer_mod, "_lookup_club_by_ig", lambda _: None)
    create = Mock(return_value={"id": 7, "club_name": "Tea Club"})
    monkeypatch.setattr(org_resolve.event_writer_mod, "_ensure_club_by_ig", create)
    resolved = resolve_club_for_scrape(
        ig_handle=["@TEA", "tea"], school="uwaterloo", club_name=None
    )
    assert resolved.club_id == 7
    create.assert_called_once()
