"""Tests for QR resolve + scan recording and list endpoints. Use mocks so no DB required."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from services import qr_code_service


@pytest.fixture
def client():
    return TestClient(app)


def test_resolve_qr_404(client):
    """GET /qr/nonexistent returns 404 when QR code is not found."""
    async def mock_get_none(_db, qr_code_id):
        return None

    def mock_get_db():
        yield AsyncMock()

    app.dependency_overrides[get_db] = mock_get_db
    original_get = qr_code_service.get_qr_code_by_id
    qr_code_service.get_qr_code_by_id = AsyncMock(side_effect=mock_get_none)
    try:
        resp = client.get("/qr/nonexistent-id")
        assert resp.status_code == 404
    finally:
        qr_code_service.get_qr_code_by_id = original_get
        app.dependency_overrides.pop(get_db, None)


def test_resolve_qr_records_scan_and_returns_config(client):
    """GET /qr/{id} records a scan and returns redirect config."""
    mock_qr = MagicMock()
    mock_qr.id = "test-qr-1"
    mock_qr.destination_type = "custom-url"
    mock_qr.destination_id = "https://example.com"
    mock_qr.filters = None

    async def mock_get(_db, qr_code_id):
        return mock_qr if qr_code_id == "test-qr-1" else None

    mock_scan = MagicMock()

    async def mock_record(_db, qr_code_id, *, session_id, user_id=None, user_agent=None):
        return mock_scan

    def mock_get_db():
        yield AsyncMock()

    app.dependency_overrides[get_db] = mock_get_db
    orig_get = qr_code_service.get_qr_code_by_id
    orig_record = qr_code_service.record_scan
    qr_code_service.get_qr_code_by_id = AsyncMock(side_effect=mock_get)
    qr_code_service.record_scan = AsyncMock(side_effect=mock_record)
    try:
        resp = client.get("/qr/test-qr-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["destination_type"] == "custom-url"
        assert data["destination_id"] == "https://example.com"
        assert qr_code_service.record_scan.await_count == 1
    finally:
        qr_code_service.get_qr_code_by_id = orig_get
        qr_code_service.record_scan = orig_record
        app.dependency_overrides.pop(get_db, None)
