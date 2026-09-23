from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from core.controlbox import controlbox
from main import app
from routers import discovery_queries
from schemas.discovery_query import DiscoveryQueryResponse
from services import discovery_query_service


def payload(**changes):
    return {
        "id": str(uuid4()),
        "school": "uwaterloo",
        "surface": "events",
        "search_query": "missing club",
        "page_url": "https://uwaterloo.wat2do.io/?source=poster",
        "filters": {"categories": ["Technology"], "maxPrice": "0", "going": False},
        **changes,
    }


@pytest.fixture(autouse=True)
def reset_limiter():
    discovery_queries._limiter._requests.clear()
    yield
    discovery_queries._limiter._requests.clear()


@pytest.mark.parametrize("surface", ["events", "clubs", "positions"])
def test_anonymous_capture_preserves_query_and_filters(client, monkeypatch, surface):
    record = MagicMock()
    monkeypatch.setattr(discovery_query_service, "record_query", record)
    body = payload(surface=surface, search_query="")
    response = client.post("/discovery-queries/", json=body)
    assert response.status_code == 204
    assert response.content == b""
    assert record.call_args.args[0].model_dump(mode="json") == body


@pytest.mark.parametrize(
    "changes",
    [
        {"surface": "users"},
        {"id": "bad-id"},
        {"school": ""},
        {"page_url": "javascript:alert(1)"},
        {"filters": []},
        {"search_query": "x" * (controlbox.discovery_queries.maximum_search_length + 1)},
        {"filters": {"text": "界" * (controlbox.discovery_queries.maximum_filters_bytes // 3 + 1)}},
        {"user_id": str(uuid4())},
    ],
)
def test_invalid_telemetry_is_rejected_before_writes(client, monkeypatch, changes):
    record = MagicMock()
    monkeypatch.setattr(discovery_query_service, "record_query", record)
    assert client.post("/discovery-queries/", json=payload(**changes)).status_code == 422
    record.assert_not_called()


def test_failed_persistence_does_not_acknowledge_success(monkeypatch):
    monkeypatch.setattr(
        discovery_query_service, "record_query", MagicMock(side_effect=RuntimeError("offline"))
    )
    response = TestClient(app, raise_server_exceptions=False).post(
        "/discovery-queries/", json=payload()
    )
    assert response.status_code == 500


def test_capture_rate_limit(client, monkeypatch):
    monkeypatch.setattr(discovery_queries._limiter, "max_requests", 1)
    record = MagicMock()
    monkeypatch.setattr(discovery_query_service, "record_query", record)
    assert client.post("/discovery-queries/", json=payload()).status_code == 204
    assert client.post("/discovery-queries/", json=payload()).status_code == 429
    record.assert_called_once()


def test_logs_are_not_public(client):
    assert client.get("/discovery-queries/").status_code == 401


def test_regular_users_cannot_read_logs(authenticated_client):
    assert authenticated_client.get("/discovery-queries/").status_code == 403


def test_admin_list_uses_shared_pagination_and_filters(admin_client, monkeypatch):
    row = DiscoveryQueryResponse(**payload(), created_at="2026-09-22T12:00:00Z")
    read = MagicMock(return_value=([row], 25))
    monkeypatch.setattr(discovery_query_service, "list_queries", read)
    response = admin_client.get(
        "/discovery-queries/?page=2&page_size=20&school=uwaterloo&search=missing"
    )
    assert response.status_code == 200
    assert response.json() == {
        "items": [row.model_dump(mode="json")],
        "total": 25,
        "page": 2,
        "page_size": 20,
        "total_pages": 2,
    }
    read.assert_called_once_with(offset=20, limit=20, school="uwaterloo", search="missing")
