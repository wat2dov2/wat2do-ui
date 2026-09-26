from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services import position_service


def _position_row(position_id: int = 1) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": position_id,
        "club_id": 4,
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
        "clubs": {
            "club_name": "UW Design Club",
            "logo_url": "https://example.com/logo.png",
            "club_type": "student-club",
            "club_page": "https://example.com",
            "ig": "uwdesign",
            "discord": "https://discord.gg/example",
        },
        "school_record": {"slug": "uwaterloo"},
    }


def test_list_positions_hydrates_club_and_school(fake_sb, patch_sb, monkeypatch):
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
        club_id=4,
    )

    assert total == 1
    assert positions[0].club_name == "UW Design Club"
    assert positions[0].club_logo_url == "https://example.com/logo.png"
    assert positions[0].club_type == "student-club"
    assert positions[0].club_page == "https://example.com"
    assert positions[0].club_discord == "https://discord.gg/example"
    assert positions[0].school == "uwaterloo"
    fake_sb.eq.assert_any_call("school_id", 1)
    fake_sb.eq.assert_any_call("position_type", "committee")
    fake_sb.eq.assert_any_call("club_id", 4)
    fake_sb.eq.assert_any_call("is_active", True)
    assert fake_sb.or_.call_count == 2


def test_list_positions_applies_added_since_before_pagination(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[], count=0)
    cutoff = datetime(2026, 9, 9, 12, tzinfo=timezone.utc)

    position_service.list_positions(
        added_since=cutoff, position_type="committee", skip=20, limit=10
    )

    fake_sb.gte.assert_called_once_with("added_at", cutoff.isoformat())
    fake_sb.eq.assert_any_call("position_type", "committee")
    fake_sb.range.assert_called_once_with(20, 29)


def test_paid_filter_requires_explicit_true(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[], count=0)
    position_service.list_positions(paid_only=True)
    fake_sb.eq.assert_any_call("is_paid", True)


def test_latest_position_is_school_scoped_and_open(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.position_service")
    monkeypatch.setattr(position_service.school_service, "get_school_id", lambda _school: 2)
    fake_sb.set_response(data=[{"title": "Latest role", "added_at": "2026-09-09T12:00:00Z"}])
    latest = position_service.get_latest_added_position("mcmaster")
    assert latest.title == "Latest role"
    fake_sb.eq.assert_any_call("school_id", 2)
    fake_sb.eq.assert_any_call("is_active", True)
    fake_sb.order.assert_any_call("added_at", desc=True)


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
    assert position.club_ig == "uwdesign"


@pytest.mark.parametrize("read", ["list", "detail"])
def test_position_reads_exclude_unused_database_metadata(fake_sb, patch_sb, read):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[_position_row()], count=1)

    if read == "list":
        [position], _ = position_service.list_positions()
    else:
        position = position_service.get_position(1)

    columns = fake_sb.select.call_args.args[0]
    assert "*" not in columns
    assert "ingestion_source" not in columns
    assert "updated_at" not in columns
    assert position is not None
    response = position.model_dump(mode="json")
    assert "ingestion_source" not in response
    assert "updated_at" not in response
    assert response["requirements"] == ["Portfolio"]
    assert response["source_url"] == "https://instagram.com/p/example/"
    assert response["club_discord"] == "https://discord.gg/example"


def test_get_club_position_counts_aggregates_open_count(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(
        data=[
            {"club_id": 1},
            {"club_id": 1},
            {"club_id": 2},
        ]
    )

    counts = position_service.get_club_position_counts([1, 2, 99])

    assert counts == {1: 2, 2: 1, 99: 0}
    fake_sb.eq.assert_called_once_with("is_active", True)


@pytest.mark.parametrize("sort_order,descending", [("asc", False), ("desc", True)])
def test_list_positions_orders_deadlines_before_pagination(
    fake_sb, patch_sb, sort_order, descending
):
    patch_sb("services.position_service")
    fake_sb.set_response(data=[], count=0)
    position_service.list_positions(sort_order=sort_order, include_closed=True, skip=20, limit=20)
    fake_sb.order.assert_any_call("deadline_date", desc=descending, nullsfirst=False)
    fake_sb.order.assert_any_call("deadline_at", desc=descending, nullsfirst=False)
    fake_sb.order.assert_any_call("id", desc=descending)
    fake_sb.range.assert_called_once_with(20, 39)
