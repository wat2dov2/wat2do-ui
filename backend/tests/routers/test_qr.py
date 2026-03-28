"""Tests for QR resolve + scan recording. Use mocks so no DB required."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.qr_code import QrCodeRedirect
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


def test_resolve_inactive_qr_requires_location(client):
    """First scan on an inactive poster returns 202 until lat/lon is provided."""
    mock_qr = {
        "id": "inactive-1",
        "destination_type": "event",
        "destination_id": "42",
        "filters": None,
        "is_active": False,
    }

    def mock_get(qr_code_id):
        return mock_qr if qr_code_id == "inactive-1" else None

    original_get = qr_code_service.get_qr_code_by_id
    qr_code_service.get_qr_code_by_id = MagicMock(side_effect=mock_get)
    try:
        resp = client.get("/qr/inactive-1")
        assert resp.status_code == 202
        assert resp.json()["detail"] == "requires_location"
    finally:
        qr_code_service.get_qr_code_by_id = original_get


def test_resolve_inactive_qr_with_location_activates_and_returns_config(client):
    """First scan with lat/lon activates poster and returns redirect config."""
    mock_qr = {
        "id": "inactive-2",
        "destination_type": "event",
        "destination_id": "99",
        "filters": None,
        "is_active": False,
    }
    redirect = QrCodeRedirect(
        destination_type="event",
        destination_id=99,
        filters=None,
    )

    def mock_get(qr_code_id):
        return mock_qr if qr_code_id == "inactive-2" else None

    original_get = qr_code_service.get_qr_code_by_id
    original_activate = qr_code_service.activate_poster_and_record_scan
    qr_code_service.get_qr_code_by_id = MagicMock(side_effect=mock_get)
    qr_code_service.activate_poster_and_record_scan = MagicMock(return_value=redirect)
    try:
        resp = client.get("/qr/inactive-2", params={"lat": 43.47, "lon": -80.54})
        assert resp.status_code == 200
        data = resp.json()
        assert data["destination_type"] == "event"
        assert data["destination_id"] == 99
        assert qr_code_service.activate_poster_and_record_scan.call_count == 1
        call_kw = qr_code_service.activate_poster_and_record_scan.call_args
        assert call_kw[0][0] == "inactive-2"
        assert call_kw[0][1] == pytest.approx(43.47)
        assert call_kw[0][2] == pytest.approx(-80.54)
    finally:
        qr_code_service.get_qr_code_by_id = original_get
        qr_code_service.activate_poster_and_record_scan = original_activate
