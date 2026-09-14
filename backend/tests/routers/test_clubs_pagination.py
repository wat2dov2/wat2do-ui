from unittest.mock import MagicMock

import pytest

from schemas.club import ClubResponse
from services import club_service


def _mock_org(id: int, name: str) -> ClubResponse:
    return ClubResponse(
        id=id,
        club_name=name,
        club_type="wusa",
        categories=["tech", "social"],
        created_by="some-uuid",
        school="uwaterloo",
    )


def test_list_clubs_paginated(client, monkeypatch):
    mock_items = [_mock_org(1, "Club 1"), _mock_org(2, "Club 2")]
    mock_list = MagicMock(return_value=(mock_items, 15))
    monkeypatch.setattr(club_service, "list_clubs", mock_list)

    response = client.get("/clubs/?page=2&page_size=2")
    assert response.status_code == 200
    data = response.json()
    assert data["items"][0]["club_name"] == "Club 1"
    assert data["total"] == 15
    assert data["page"] == 2
    assert data["page_size"] == 2
    assert data["total_pages"] == 8

    mock_list.assert_called_once_with(
        skip=2,
        limit=2,
        club_type=None,
        school=None,
        search=None,
        categories=None,
        ids=None,
        min_events=0,
    )


def test_list_clubs_filters(client, monkeypatch):
    mock_items = [_mock_org(1, "Club 1")]
    mock_list = MagicMock(return_value=(mock_items, 1))
    monkeypatch.setattr(club_service, "list_clubs", mock_list)

    response = client.get(
        "/clubs/?club_type=independent&school=uwaterloo&search=club&categories=tech&categories=social&ids=1&ids=2"
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1

    mock_list.assert_called_once_with(
        skip=0,
        limit=50,
        club_type="independent",
        school="uwaterloo",
        search="club",
        categories=["tech", "social"],
        ids=[1, 2],
        min_events=0,
    )
