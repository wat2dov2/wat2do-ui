"""Tests for QR resolve + scan recording. Use mocks so no DB required."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from services import qr_code_service


@pytest.fixture
def client():
    return TestClient(app)


def test_resolve_qr_404(client):
    """GET /qr/nonexistent returns 404 when QR code is not found."""
    original_get = qr_code_service.get_qr_code_by_id
    qr_code_service.get_qr_code_by_id = MagicMock(return_value=None)
    try:
        resp = client.get("/qr/nonexistent-id")
        assert resp.status_code == 404
    finally:
        qr_code_service.get_qr_code_by_id = original_get


def test_resolve_qr_records_scan_and_returns_config(client):
    """GET /qr/{id} records a scan and returns redirect config."""
    mock_qr = {"id": "test-qr-1", "destination_type": "custom-url", "destination_id": "https://example.com", "filters": None, "is_active": True}

    def mock_get(qr_code_id):
        return mock_qr if qr_code_id == "test-qr-1" else None

    original_get = qr_code_service.get_qr_code_by_id
    original_record = qr_code_service.record_scan
    qr_code_service.get_qr_code_by_id = MagicMock(side_effect=mock_get)
    qr_code_service.record_scan = MagicMock(return_value={})
    try:
        resp = client.get("/qr/test-qr-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["destination_type"] == "custom-url"
        assert data["destination_id"] == "https://example.com"
        assert qr_code_service.record_scan.call_count == 1
    finally:
        qr_code_service.get_qr_code_by_id = original_get
        qr_code_service.record_scan = original_record
