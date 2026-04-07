"""Tests for QR resolve + scan recording + ownership. Use mocks so no DB required."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.qr_code import QrCodeRedirect, QrCodeResponse
from services import qr_code_service
from tests.conftest import FAKE_USER, OTHER_USER


def _mock_qr(**overrides) -> QrCodeResponse:
    """Build a QrCodeResponse with sensible defaults, overridden by kwargs."""
    defaults = {
        "id": "test-qr",
        "name": "Test",
        "description": None,
        "destination_type": "custom-url",
        "destination_id": None,
        "filters": None,
        "created_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
        "is_active": True,
        "image_url": None,
        "latitude": 0.0,
        "longitude": 0.0,
    }
    defaults.update(overrides)
    return QrCodeResponse.model_validate(defaults)


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
    mock_qr = _mock_qr(id="test-qr-1", destination_type="custom-url", destination_id="https://example.com")

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
    mock_qr = _mock_qr(id="inactive-1", destination_type="event", destination_id="42", is_active=False)

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
    mock_qr = _mock_qr(id="inactive-2", destination_type="event", destination_id="99", is_active=False)
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


# ── Ownership tests ─────────────────────────────────────────────────────


def test_create_poster_sets_created_by(authenticated_client, monkeypatch):
    """create_poster overrides created_by with the authenticated user's ID."""
    qr = _mock_qr()
    mock_upsert = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "upsert_qr_code", mock_upsert)

    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "test-qr",
            "name": "Test",
            "destination_type": "custom-url",
            "created_by": "attacker-id",  # should be overridden
        },
    )
    assert resp.status_code == 201
    _, kwargs = mock_upsert.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_update_poster_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot update a QR code."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = other_user_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Hacked",
            "destination_type": "custom-url",
            "created_by": OTHER_USER["id"],
        },
    )
    assert resp.status_code == 403


def test_delete_poster_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot delete a QR code."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = other_user_client.delete("/qr/test-qr")
    assert resp.status_code == 403


def test_delete_poster_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own QR code."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "delete_qr_code", MagicMock())

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.delete("/qr/test-qr")
    assert resp.status_code == 204
