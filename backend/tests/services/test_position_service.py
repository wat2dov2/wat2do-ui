from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from services import position_service


def _position_row(position_id: int = 1) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": position_id,
        "organization_id": 4,
        "school_id": 1,
        "title": "Design Lead",
        "description": "Lead the design team.",
        "position_type": "committee",
        "requirements": ["Portfolio"],
        "commitment": "3 hours per week",
        "compensation": "Volunteer",
        "location": "Hybrid",
        "contact_email": "team@example.com",
        "deadline_date": (now + timedelta(days=7)).date().isoformat(),
        "deadline_at": None,
        "source_url": "https://instagram.com/p/example/",
        "source_image_url": "https://example.com/post.jpg",
        "ingestion_source": "seed",
        "is_active": True,
        "added_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "organizations": {
            "organization_name": "UW Design Club",
            "logo_url": "https://example.com/logo.png",
            "organization_type": "student-club",
            "organization_page": "https://example.com",
            "ig": "uwdesign",
            "discord": "https://discord.gg/example",
        },
        "school_record": {"slug": "uwaterloo"},
    }


def test_list_positions_hydrates_organization_and_school(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.position_service")
    monkeypatch.setattr(
        position_service.school_service,
        "get_school_id",
        lambda _school: 1,
    )
    fake_sb.set_response(data=[_position_row()], count=1)

    positions, total = position_service.list_positions(
        school="uwaterloo",
        search="design",
        position_type="committee",
        organization_id=4,
    )

    assert total == 1
    assert positions[0].organization_name == "UW Design Club"
    assert positions[0].organization_logo_url == "https://example.com/logo.png"
    assert positions[0].organization_type == "student-club"
    assert positions[0].organization_page == "https://example.com"
    assert positions[0].organization_discord == "https://discord.gg/example"
    assert positions[0].school == "uwaterloo"
    fake_sb.eq.assert_any_call("school_id", 1)
    fake_sb.eq.assert_any_call("position_type", "committee")
    fake_sb.eq.assert_any_call("organization_id", 4)
    fake_sb.eq.assert_any_call("is_active", True)
    assert fake_sb.or_.call_count == 2


def test_list_positions_returns_empty_for_unknown_school(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.position_service")
    monkeypatch.setattr(
        position_service.school_service,
        "get_school_id",
        lambda _school: None,
    )

    positions, total = position_service.list_positions(school="unknown")

    assert positions == []
    assert total == 0
    fake_sb.execute.assert_not_called()


def test_list_positions_can_include_closed(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[_position_row()], count=1)

    positions, total = position_service.list_positions(include_closed=True)

    assert len(positions) == 1
    assert total == 1
    fake_sb.eq.assert_not_called()
    fake_sb.or_.assert_not_called()


def test_get_position_returns_none_when_missing(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[])

    assert position_service.get_position(99) is None


def test_get_position_returns_hydrated_position(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[_position_row(7)])

    position = position_service.get_position(7)

    assert position is not None
    assert position.id == 7
    assert position.organization_ig == "uwdesign"


def test_get_organization_position_counts_aggregates_open_count(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(
        data=[
            {"organization_id": 1},
            {"organization_id": 1},
            {"organization_id": 2},
        ]
    )

    counts = position_service.get_organization_position_counts([1, 2, 99])

    assert counts == {1: 2, 2: 1, 99: 0}
    fake_sb.eq.assert_called_once_with("is_active", True)
