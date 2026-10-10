from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError

from core.exceptions import ValidationError
from services.scraper.org_resolve import ResolvedClub
from services.scraper.position_writer import normalize_position_update, write_position


def _position() -> dict:
    return {
        "title": "Design Lead",
        "description": "Lead the visual design team.",
        "club": "UW Design Club",
        "position_type": "committee",
        "requirements": ["Portfolio", "Clear communication"],
        "commitment": "3 hours per week",
        "compensation": "Volunteer",
        "is_paid": False,
        "location": "Hybrid",
        "contact_email": "design@example.com",
        "deadline_date": "2026-08-31",
        "deadline_at": None,
        "source_image_url": "https://example.com/design-lead.jpg",
        "source_video_url": "https://wat2do.io/media/event-videos/reel.mp4",
        "school": "uwaterloo",
    }


@pytest.mark.parametrize("ingestion_source", ["instagram_scraper", "directory"])
def test_write_position_inserts_scraper_payload(fake_sb, patch_sb, monkeypatch, ingestion_source):
    patch_sb("services.scraper.position_writer")
    revalidate = MagicMock()
    monkeypatch.setattr(
        "services.scraper.position_writer.school_service.get_school",
        lambda slug: SimpleNamespace(id=9, slug=slug),
    )
    monkeypatch.setattr(
        "services.scraper.position_writer.event_feed_revalidation_service.revalidate_school",
        revalidate,
    )
    fake_sb.set_response(data=[{"id": 41}])

    outcome = write_position(
        _position(),
        ig_handle="uwdesign",
        source_url="https://www.instagram.com/p/HIRING123/",
        resolved_org=ResolvedClub(
            club_id=7,
            club_name="UW Design Club",
            ig_handle="uwdesign",
            cohost_club_ids=(8, 10),
        ),
        ingestion_source=ingestion_source,
    )

    assert outcome == "inserted"
    payload = fake_sb.insert.call_args.args[0]
    assert payload["club_id"] == 7
    assert payload["cohost_club_ids"] == [8, 10]
    assert payload["school_id"] == 9
    assert payload["title"] == "Design Lead"
    assert payload["source_video_url"] == "https://wat2do.io/media/event-videos/reel.mp4"
    assert payload["is_paid"] is False
    assert payload["requirements"] == ["Portfolio", "Clear communication"]
    assert payload["source_url"] == "https://www.instagram.com/p/HIRING123/"
    assert payload["ingestion_source"] == ingestion_source
    revalidate.assert_called_once_with("uwaterloo", resources=("positions", "clubs"))


def test_write_position_skips_unresolved_club(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.position_writer")
    monkeypatch.setattr(
        "services.scraper.position_writer.school_service.get_school",
        lambda slug: SimpleNamespace(id=9, slug=slug),
    )

    outcome = write_position(
        _position(),
        ig_handle="uwdesign",
        source_url="https://www.instagram.com/p/HIRING123/",
        resolved_org=ResolvedClub(
            club_id=None,
            club_name="UW Design Club",
            ig_handle="uwdesign",
        ),
    )

    assert outcome == "skipped"
    fake_sb.insert.assert_not_called()


def _existing_position() -> dict:
    extracted = _position()
    return {
        **{key: value for key, value in extracted.items() if key not in {"club", "school"}},
        "id": 5486,
        "club_id": 7,
        "school_id": 9,
        "cohost_club_ids": [8, 10],
        "source_url": "https://www.instagram.com/p/ORIGINAL/",
        "ingestion_source": "instagram_scraper",
        "is_active": True,
        "added_at": "2026-09-01T12:00:00+00:00",
        "updated_at": "2026-09-01T12:00:00+00:00",
    }


def test_reviewed_update_extends_existing_role_without_replacing_identity(
    fake_sb, patch_sb, monkeypatch
):
    patch_sb("services.scraper.position_writer")
    revalidate = MagicMock()
    monkeypatch.setattr(
        "services.scraper.position_writer.school_service.get_school",
        lambda slug: SimpleNamespace(id=9, slug=slug),
    )
    monkeypatch.setattr(
        "services.scraper.position_writer.event_feed_revalidation_service.revalidate_school",
        revalidate,
    )
    expected = _existing_position()
    proposal = {**expected, "school": "uwaterloo", "deadline_date": "2026-10-09"}
    proposal["deadline_at"] = "2026-10-10T03:59:00Z"
    proposal["description"] = "Applications extended. Lead the visual design team."
    persisted = {
        **expected,
        "description": proposal["description"],
        "deadline_date": "2026-10-09",
        "deadline_at": "2026-10-10T03:59:00+00:00",
        "updated_at": "2026-10-09T12:00:00+00:00",
    }
    fake_sb.set_response(data=[persisted])

    outcome = write_position(
        proposal,
        ig_handle="uwdesign",
        source_url="https://www.instagram.com/p/EXTENSION/",
        resolved_org=ResolvedClub(club_id=7, club_name="UW Design Club", ig_handle="uwdesign"),
        expected_position=expected,
    )

    assert outcome == "updated"
    name, arguments = fake_sb.rpc.call_args.args
    assert name == "update_reviewed_position"
    assert arguments["p_position_id"] == 5486
    assert arguments["p_expected_position"] == expected
    assert arguments["p_position_patch"] == {
        "description": proposal["description"],
        "deadline_date": "2026-10-09",
        "deadline_at": "2026-10-10T03:59:00+00:00",
    }
    fake_sb.insert.assert_not_called()
    revalidate.assert_called_once_with("uwaterloo", resources=("positions", "clubs"))


@pytest.fixture
def reviewed_writer(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.position_writer")
    revalidate = MagicMock()
    monkeypatch.setattr(
        "services.scraper.position_writer.school_service.get_school",
        lambda slug: SimpleNamespace(id=9, slug=slug) if slug == "uwaterloo" else None,
    )
    monkeypatch.setattr(
        "services.scraper.position_writer.event_feed_revalidation_service.revalidate_school",
        revalidate,
    )
    return {
        "ig_handle": "uwdesign",
        "source_url": "https://www.instagram.com/p/EXTENSION/",
        "resolved_org": ResolvedClub(club_id=7, club_name="UW Design Club", ig_handle="uwdesign"),
        "expected_position": _existing_position(),
    }, revalidate


@pytest.mark.parametrize("position_id", [None, True, 0, "5486"])
def test_reviewed_update_rejects_missing_or_nonpositive_strict_integer_id(
    position_id, reviewed_writer, fake_sb
):
    kwargs, revalidate = reviewed_writer
    proposal = {
        "id": position_id,
        "school": "uwaterloo",
        "deadline_date": "2026-10-09",
    }

    with pytest.raises(ValidationError, match="complete matching baseline"):
        write_position(proposal, **kwargs)

    fake_sb.execute.assert_not_called()
    revalidate.assert_not_called()


@pytest.mark.parametrize(
    "bad_binding", ["missing_baseline", "incomplete_baseline", "changed_media", "unknown_field"]
)
def test_reviewed_update_rejects_unbound_or_reinterpreted_row(
    bad_binding, reviewed_writer, fake_sb
):
    kwargs, revalidate = reviewed_writer
    proposal = {"id": 5486, "school": "uwaterloo", "deadline_date": "2026-10-09"}
    if bad_binding == "missing_baseline":
        kwargs["expected_position"] = None
    elif bad_binding == "incomplete_baseline":
        kwargs["expected_position"].pop("updated_at")
    elif bad_binding == "changed_media":
        proposal["source_image_url"] = "https://example.com/new-trigger.jpg"
    else:
        proposal["expected_existing"] = kwargs["expected_position"]

    with pytest.raises(ValidationError, match="complete matching baseline"):
        write_position(proposal, **kwargs)

    fake_sb.execute.assert_not_called()
    revalidate.assert_not_called()


@pytest.mark.parametrize("bad_ownership", ["school", "host"])
def test_reviewed_update_rejects_wrong_registered_owner(bad_ownership, reviewed_writer, fake_sb):
    kwargs, revalidate = reviewed_writer
    proposal = {"id": 5486, "school": "uwaterloo", "deadline_date": "2026-10-09"}
    if bad_ownership == "school":
        proposal["school"] = "uwindsor"
    else:
        kwargs["resolved_org"] = ResolvedClub(club_id=8, club_name="Other", ig_handle="other")

    with pytest.raises(ValidationError, match="mismatched source ownership"):
        write_position(proposal, **kwargs)

    fake_sb.execute.assert_not_called()
    revalidate.assert_not_called()


def test_partial_reviewed_update_keeps_original_optional_fields_and_full_raw_snapshot():
    expected = _existing_position()
    expected["source_video_url"] = None
    proposal = {"id": 5486, "deadline_date": "2026-10-09", "deadline_at": "2026-10-10T03:59:00Z"}

    normalized = normalize_position_update(proposal, expected_position=expected)

    assert normalized == {
        **expected,
        "deadline_date": "2026-10-09",
        "deadline_at": "2026-10-10T03:59:00+00:00",
    }
    assert expected == _existing_position() | {"source_video_url": None}
    assert proposal["deadline_at"].endswith("Z")


def test_reviewed_update_rejects_semantic_noop_without_claiming_a_write(reviewed_writer, fake_sb):
    kwargs, _revalidate = reviewed_writer
    expected = kwargs["expected_position"]
    expected["deadline_date"] = "2026-10-09"
    expected["deadline_at"] = "2026-10-10T03:59:00+00:00"
    proposal = {
        "id": 5486,
        "school": "uwaterloo",
        "description": f"  {expected['description']}  ",
        "deadline_date": expected["deadline_date"],
        "deadline_at": "2026-10-10T03:59:00Z",
    }

    with pytest.raises(ValidationError, match="no changes"):
        write_position(proposal, **kwargs)

    fake_sb.execute.assert_not_called()


@pytest.mark.parametrize(
    "invalid_fields",
    [
        {"requirements": "not an array"},
        {"deadline_date": None, "deadline_at": "2026-10-10T03:59:00"},
        {"is_paid": "false"},
    ],
)
def test_reviewed_update_rejects_malformed_role_fields(invalid_fields, reviewed_writer, fake_sb):
    kwargs, _revalidate = reviewed_writer
    proposal = {"id": 5486, "school": "uwaterloo", **invalid_fields}

    with pytest.raises(ValidationError, match="invalid role fields"):
        write_position(proposal, **kwargs)

    fake_sb.execute.assert_not_called()


def test_reviewed_update_never_falls_back_to_insert_after_stale_cas(reviewed_writer, fake_sb):
    kwargs, revalidate = reviewed_writer
    fake_sb.raise_on_execute(
        APIError(
            {
                "code": "23514",
                "message": "Reviewed position baseline changed or update made no changes",
                "details": None,
                "hint": None,
            }
        )
    )

    with pytest.raises(APIError, match="baseline changed"):
        write_position({"id": 5486, "school": "uwaterloo", "deadline_date": "2026-10-09"}, **kwargs)

    fake_sb.execute.assert_called_once()
    fake_sb.insert.assert_not_called()
    fake_sb.update.assert_not_called()
    revalidate.assert_not_called()


@pytest.mark.parametrize(
    "broken_response", ["missing", "changed_source", "unchanged_timestamp", "wrong_patch"]
)
def test_reviewed_update_requires_complete_exact_returned_row(
    broken_response, reviewed_writer, fake_sb
):
    kwargs, revalidate = reviewed_writer
    row = {
        **kwargs["expected_position"],
        "deadline_date": "2026-10-09",
        "updated_at": "2026-10-09T12:00:00+00:00",
    }
    if broken_response == "missing":
        rows = []
    else:
        if broken_response == "changed_source":
            row["source_url"] = kwargs["source_url"]
        elif broken_response == "unchanged_timestamp":
            row["updated_at"] = kwargs["expected_position"]["updated_at"]
        else:
            row["deadline_date"] = "2026-10-11"
        rows = [row]
    fake_sb.set_response(data=rows)

    with pytest.raises(ValidationError, match="bound full row"):
        write_position({"id": 5486, "school": "uwaterloo", "deadline_date": "2026-10-09"}, **kwargs)

    fake_sb.insert.assert_not_called()
    revalidate.assert_not_called()
