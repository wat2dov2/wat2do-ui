from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from schemas.position import PositionResponse
from services import position_service


def _position(position_id: int = 1) -> PositionResponse:
    now = datetime.now(timezone.utc)
    return PositionResponse(
        id=position_id,
        organization_id=4,
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
        ingestion_source="seed",
        is_active=True,
        added_at=now,
        updated_at=now,
        organization_name="UW Design Club",
        organization_logo_url="https://example.com/logo.png",
        organization_ig="uwdesign",
        school="uwaterloo",
    )


def test_list_positions_is_public_and_paginated(client, monkeypatch):
    list_positions = MagicMock(return_value=([_position()], 12))
    monkeypatch.setattr(position_service, "list_positions", list_positions)

    response = client.get(
        "/positions/?page=2&page_size=5&school=uwaterloo&search=design"
        "&position_type=committee&organization_id=4"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 12
    assert body["page"] == 2
    assert body["page_size"] == 5
    assert body["total_pages"] == 3
    assert body["items"][0]["title"] == "Design Lead"
    list_positions.assert_called_once_with(
        skip=5,
        limit=5,
        school="uwaterloo",
        search="design",
        position_type="committee",
        organization_id=4,
        include_closed=False,
    )


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
