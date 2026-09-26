import threading
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from core.pagination import LatestAddedItem
from schemas.position import PositionResponse
from services import position_service


@pytest.fixture(autouse=True)
def mock_latest_position(monkeypatch):
    monkeypatch.setattr(position_service, "get_latest_added_position", lambda _school: None)


def _position(position_id: int = 1) -> PositionResponse:
    now = datetime.now(timezone.utc)
    return PositionResponse(
        id=position_id,
        club_id=4,
        title="Design Lead",
        description="Lead the design team.",
        position_type="committee",
        requirements=["Portfolio"],
        commitment="3 hours per week",
        compensation="Volunteer",
        location="Hybrid",
        contact_email="team@example.com",
        deadline_date=(now + timedelta(days=7)).date(),
        deadline_at=None,
        source_url="https://instagram.com/p/example/",
        source_image_url="https://example.com/post.jpg",
        is_active=True,
        added_at=now,
        club_name="UW Design Club",
        club_logo_url="https://example.com/logo.png",
        club_ig="uwdesign",
        school="uwaterloo",
    )


def test_list_positions_is_public_and_paginated(client, monkeypatch):
    list_positions = MagicMock(return_value=([_position()], 12))
    monkeypatch.setattr(position_service, "list_positions", list_positions)

    response = client.get(
        "/positions/?page=2&page_size=5&school=uwaterloo&search=design"
        "&position_type=committee&club_id=4"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 12
    assert body["page"] == 2
    assert body["page_size"] == 5
    assert body["total_pages"] == 3
    assert body["items"][0]["title"] == "Design Lead"
    assert "ingestion_source" not in body["items"][0]
    assert "updated_at" not in body["items"][0]
    list_positions.assert_called_once_with(
        skip=5,
        limit=5,
        school="uwaterloo",
        search="design",
        position_type="committee",
        club_id=4,
        include_closed=False,
        added_since=None,
        paid_only=False,
        sort_order="asc",
    )


def test_list_positions_overlaps_directory_and_latest_queries(client, monkeypatch):
    barrier = threading.Barrier(2, timeout=2)
    latest = LatestAddedItem(
        title="Newest position", added_at=datetime(2026, 9, 25, tzinfo=timezone.utc)
    )

    def list_positions(**_kwargs):
        barrier.wait()
        return [_position()], 1

    def get_latest_added_position(school):
        assert school == "uwaterloo"
        barrier.wait()
        return latest

    monkeypatch.setattr(position_service, "list_positions", list_positions)
    monkeypatch.setattr(position_service, "get_latest_added_position", get_latest_added_position)

    response = client.get("/positions/?school=uwaterloo")

    assert response.status_code == 200
    assert response.json()["items"][0]["title"] == "Design Lead"
    assert response.json()["latest_added_position"] == latest.model_dump(mode="json")


def test_list_positions_passes_aware_added_since(client, monkeypatch):
    list_positions = MagicMock(return_value=([], 0))
    monkeypatch.setattr(position_service, "list_positions", list_positions)
    response = client.get("/positions/?added_since=2026-09-09T12:00:00Z")
    assert response.status_code == 200
    assert list_positions.call_args.kwargs["added_since"] == datetime(
        2026, 9, 9, 12, tzinfo=timezone.utc
    )


def test_list_positions_rejects_naive_added_since(client):
    assert client.get("/positions/?added_since=2026-09-09T12:00:00").status_code == 422


def test_list_positions_rejects_unknown_type(client):
    response = client.get("/positions/?position_type=unknown")

    assert response.status_code == 422


def test_get_position_is_public(client, monkeypatch):
    monkeypatch.setattr(
        position_service,
        "get_position",
        MagicMock(return_value=_position(7)),
    )

    response = client.get("/positions/7")

    assert response.status_code == 200
    assert response.json()["id"] == 7


def test_get_position_returns_404(client, monkeypatch):
    monkeypatch.setattr(
        position_service,
        "get_position",
        MagicMock(return_value=None),
    )

    response = client.get("/positions/404")

    assert response.status_code == 404
    assert response.json()["detail"] == "Position not found"


def test_list_positions_accepts_descending_deadlines(client, monkeypatch):
    list_positions = MagicMock(return_value=([], 0))
    monkeypatch.setattr(position_service, "list_positions", list_positions)
    response = client.get("/positions/?include_closed=true&sort_order=desc")
    assert response.status_code == 200
    assert list_positions.call_args.kwargs["sort_order"] == "desc"
    assert list_positions.call_args.kwargs["include_closed"] is True


def test_list_positions_rejects_unknown_sort_order(client):
    assert client.get("/positions/?sort_order=unknown").status_code == 422
