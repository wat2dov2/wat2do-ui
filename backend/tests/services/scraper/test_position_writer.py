from types import SimpleNamespace
from unittest.mock import MagicMock

from services.scraper.org_resolve import ResolvedClub
from services.scraper.position_writer import write_position


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
        "school": "uwaterloo",
    }


def test_write_position_inserts_scraper_payload(fake_sb, patch_sb, monkeypatch):
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
        ),
    )

    assert outcome == "inserted"
    payload = fake_sb.insert.call_args.args[0]
    assert payload["club_id"] == 7
    assert payload["school_id"] == 9
    assert payload["title"] == "Design Lead"
    assert payload["is_paid"] is False
    assert payload["requirements"] == ["Portfolio", "Clear communication"]
    assert payload["source_url"] == "https://www.instagram.com/p/HIRING123/"
    assert payload["ingestion_source"] == "instagram_scraper"
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
