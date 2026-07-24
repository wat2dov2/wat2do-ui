from unittest.mock import MagicMock

import pytest

from schemas.organization import OrganizationResponse
from services import organization_service


def _mock_org(id: int, name: str) -> OrganizationResponse:
    return OrganizationResponse(
        id=id,
        organization_name=name,
        organization_type="wusa",
        categories=["tech", "social"],
        created_by="some-uuid",
        school="uwaterloo",
    )


def test_list_organizations_paginated(client, monkeypatch):
    mock_items = [_mock_org(1, "Club 1"), _mock_org(2, "Club 2")]
    mock_list = MagicMock(return_value=(mock_items, 15))
    monkeypatch.setattr(organization_service, "list_organizations", mock_list)

    response = client.get("/organizations/?page=2&page_size=2")
    assert response.status_code == 200
    data = response.json()
    assert data["items"][0]["organization_name"] == "Club 1"
    assert data["total"] == 15
    assert data["page"] == 2
    assert data["page_size"] == 2
    assert data["total_pages"] == 8

    mock_list.assert_called_once_with(
        skip=2,
        limit=2,
        organization_type=None,
        school=None,
        search=None,
        categories=None,
        ids=None,
    )


def test_list_organizations_filters(client, monkeypatch):
    mock_items = [_mock_org(1, "Club 1")]
    mock_list = MagicMock(return_value=(mock_items, 1))
    monkeypatch.setattr(organization_service, "list_organizations", mock_list)

    response = client.get(
        "/organizations/?organization_type=independent&school=uwaterloo&search=club&categories=tech&categories=social&ids=1&ids=2"
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1

    mock_list.assert_called_once_with(
        skip=0,
        limit=50,
        organization_type="independent",
        school="uwaterloo",
        search="club",
        categories=["tech", "social"],
        ids=[1, 2],
    )
