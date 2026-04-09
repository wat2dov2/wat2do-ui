"""Tests for QR resolve + scan recording + ownership + rate limiting. Use mocks so no DB required."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.constants import ROLE_ADMIN
from core.rate_limit import qr_scan_rate_limiter
from main import app
from schemas.qr_code import QrCodeRedirect, QrCodeResponse
from schemas.user import UserResponse
from services import qr_code_service
from tests.conftest import FAKE_USER, ADMIN_USER, OTHER_USER


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


def _admin_db_user() -> UserResponse:
    return UserResponse(
        id="00000000-0000-0000-0000-000000000000",
        email=ADMIN_USER["email"],
        role=ROLE_ADMIN,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_qr_rate_limiter():
    """Reset the QR scan rate limiter between tests."""
    qr_scan_rate_limiter._requests.clear()
    yield
    qr_scan_rate_limiter._requests.clear()


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


# ── URL validation for custom-url destination type ─────────────────────


def test_create_poster_rejects_javascript_url(authenticated_client):
    """POST /qr/ with javascript: URL returns 422."""
    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "xss-qr",
            "name": "XSS",
            "destination_type": "custom-url",
            "destination_id": "javascript:alert(1)",
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 422


def test_create_poster_rejects_data_url(authenticated_client):
    """POST /qr/ with data: URL returns 422."""
    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "data-qr",
            "name": "Data",
            "destination_type": "custom-url",
            "destination_id": "data:text/html,<script>alert(1)</script>",
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 422


def test_create_poster_accepts_https_url(authenticated_client, monkeypatch):
    """POST /qr/ with a valid https URL succeeds."""
    qr = _mock_qr(destination_id="https://example.com")
    mock_upsert = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "upsert_qr_code", mock_upsert)

    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "safe-qr",
            "name": "Safe",
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 201


def test_update_poster_rejects_javascript_url(authenticated_client, monkeypatch):
    """PATCH /qr/{id} with javascript: URL returns 422."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Hacked",
            "destination_type": "custom-url",
            "destination_id": "javascript:alert(document.cookie)",
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 422


def test_create_poster_allows_custom_url_without_destination_id(authenticated_client, monkeypatch):
    """POST /qr/ with custom-url but no destination_id (null) is allowed."""
    qr = _mock_qr()
    mock_upsert = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "upsert_qr_code", mock_upsert)

    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "null-url-qr",
            "name": "No URL",
            "destination_type": "custom-url",
            "destination_id": None,
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 201


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


# ── 401 without auth ────────────────────────────────────────────────────


def test_create_poster_requires_auth(client):
    """POST /qr/ returns 401 without auth."""
    resp = client.post("/qr/", json={"id": "x", "name": "X", "destination_type": "custom-url"})
    assert resp.status_code == 401


def test_update_poster_requires_auth(client):
    """PATCH /qr/{id} returns 401 without auth."""
    resp = client.patch("/qr/test-qr", json={"id": "test-qr", "name": "X", "destination_type": "custom-url"})
    assert resp.status_code == 401


def test_delete_poster_requires_auth(client):
    """DELETE /qr/{id} returns 401 without auth."""
    resp = client.delete("/qr/test-qr")
    assert resp.status_code == 401


def test_list_qr_codes_requires_auth(client):
    """GET /qr/ returns 401 without auth."""
    resp = client.get("/qr/")
    assert resp.status_code == 401


def test_list_scans_requires_auth(client):
    """GET /qr/scans returns 401 without auth."""
    resp = client.get("/qr/scans")
    assert resp.status_code == 401


# ── Admin sees all vs user sees own ─────────────────────────────────────


def test_list_qr_codes_user_sees_own(authenticated_client, monkeypatch):
    """Regular user only sees their own QR codes (created_by filter applied)."""
    own_qr = [_mock_qr(created_by=FAKE_USER["id"])]
    mock_list = MagicMock(return_value=(own_qr, 1))
    monkeypatch.setattr(qr_code_service, "list_qr_codes", mock_list)

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.get("/qr/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["total"] == 1
    # Verify the service was called with the user's created_by filter
    _, kwargs = mock_list.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_list_qr_codes_admin_sees_all(admin_client, monkeypatch):
    """Admin sees all QR codes (no created_by filter)."""
    all_qrs = [_mock_qr(created_by=FAKE_USER["id"]), _mock_qr(id="other-qr", created_by=OTHER_USER["id"])]
    mock_list = MagicMock(return_value=(all_qrs, 2))
    monkeypatch.setattr(qr_code_service, "list_qr_codes", mock_list)

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user()))

    resp = admin_client.get("/qr/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["total"] == 2
    # Admin: called without created_by filter (only offset/limit kwargs)
    _, kwargs = mock_list.call_args
    assert "created_by" not in kwargs


def test_list_scans_user_sees_own(authenticated_client, monkeypatch):
    """Regular user scans are filtered by owned_by."""
    mock_list = MagicMock(return_value=([], 0))
    monkeypatch.setattr(qr_code_service, "list_scans", mock_list)

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.get("/qr/scans")
    assert resp.status_code == 200
    _, kwargs = mock_list.call_args
    assert kwargs["owned_by"] == FAKE_USER["id"]


def test_list_scans_admin_sees_all(admin_client, monkeypatch):
    """Admin scans have owned_by=None (sees all)."""
    mock_list = MagicMock(return_value=([], 0))
    monkeypatch.setattr(qr_code_service, "list_scans", mock_list)

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user()))

    resp = admin_client.get("/qr/scans")
    assert resp.status_code == 200
    _, kwargs = mock_list.call_args
    assert kwargs["owned_by"] is None


# ── Owner can update (success) ──────────────────────────────────────────


def test_update_poster_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own QR code."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    updated = _mock_qr(name="Updated Name", created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "upsert_qr_code", MagicMock(return_value=updated))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Updated Name",
            "destination_type": "custom-url",
            "created_by": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


# ── Admin can update/delete non-owned QR codes ──────────────────────────


def test_admin_can_update_non_owned_qr(admin_client, monkeypatch):
    """Admin can update a QR code they don't own."""
    existing = _mock_qr(created_by=OTHER_USER["id"])
    updated = _mock_qr(name="Admin Fix", created_by=OTHER_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "upsert_qr_code", MagicMock(return_value=updated))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user()))

    resp = admin_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Admin Fix",
            "destination_type": "custom-url",
            "created_by": OTHER_USER["id"],
        },
    )
    assert resp.status_code == 200


def test_admin_can_delete_non_owned_qr(admin_client, monkeypatch):
    """Admin can delete a QR code they don't own."""
    existing = _mock_qr(created_by=OTHER_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "delete_qr_code", MagicMock())

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user()))

    resp = admin_client.delete("/qr/test-qr")
    assert resp.status_code == 204


# ── QR scan rate limiting ────────────────────────────────────────────────


def test_qr_scan_rate_limit_triggers_429(client):
    """Exceeding the QR scan rate limit returns 429 with Retry-After header."""
    mock_qr = _mock_qr(id="rate-test", destination_type="custom-url", destination_id="https://example.com")
    original_get = qr_code_service.get_qr_code_by_id
    original_record = qr_code_service.record_scan
    qr_code_service.get_qr_code_by_id = MagicMock(return_value=mock_qr)
    qr_code_service.record_scan = MagicMock(return_value={})

    original_max = qr_scan_rate_limiter.max_requests
    qr_scan_rate_limiter.max_requests = 2
    try:
        r1 = client.get("/qr/rate-test")
        r2 = client.get("/qr/rate-test")
        assert r1.status_code == 200
        assert r2.status_code == 200

        r3 = client.get("/qr/rate-test")
        assert r3.status_code == 429
        assert "Too many requests" in r3.json()["detail"]
        assert "Retry-After" in r3.headers
        assert int(r3.headers["Retry-After"]) >= 1
    finally:
        qr_scan_rate_limiter.max_requests = original_max
        qr_code_service.get_qr_code_by_id = original_get
        qr_code_service.record_scan = original_record


def test_qr_scan_rate_limit_allows_within_limit(client):
    """Requests within the rate limit proceed normally."""
    mock_qr = _mock_qr(id="ok-test", destination_type="custom-url", destination_id="https://example.com")
    original_get = qr_code_service.get_qr_code_by_id
    original_record = qr_code_service.record_scan
    qr_code_service.get_qr_code_by_id = MagicMock(return_value=mock_qr)
    qr_code_service.record_scan = MagicMock(return_value={})

    try:
        # Default limit is 30/min — a few requests should be fine
        for _ in range(3):
            resp = client.get("/qr/ok-test")
            assert resp.status_code == 200
    finally:
        qr_code_service.get_qr_code_by_id = original_get
        qr_code_service.record_scan = original_record
