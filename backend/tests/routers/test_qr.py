"""Tests for QR resolve + scan recording + ownership + rate limiting. Use mocks so no DB required."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.constants import ROLE_ADMIN
from core.rate_limit import qr_scan_rate_limiter
from main import app
from schemas.organization import OrganizationResponse
from schemas.qr_code import (
    PromoterEarningsResponse,
    QrCodeRedirect,
    QrCodeResponse,
    QrScanConfirmResponse,
)
from schemas.user import UserResponse
from services import organization_service, poster_payout_service, qr_code_service, user_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER, make_db_user


@pytest.fixture(autouse=True)
def mock_list_organizations(monkeypatch):
    """By default, users own no organizations."""
    mock = MagicMock(return_value=[])
    monkeypatch.setattr(organization_service, "list_organizations_by_owner", mock)
    return mock


@pytest.fixture
def organization_owner_client(authenticated_client, monkeypatch):
    """Client authenticated as a standard user who owns a organization."""
    mock_organization = OrganizationResponse(
        id=123,
        organization_name="Test Organization",
        organization_type="independent",
        created_by=FAKE_USER["id"],
    )
    monkeypatch.setattr(
        organization_service,
        "list_organizations_by_owner",
        MagicMock(return_value=[mock_organization]),
    )
    return authenticated_client


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
        "program": "standard",
        "latest_scan": datetime.now(timezone.utc),
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


@pytest.fixture(autouse=True)
def _poster_scan_secrets(monkeypatch):
    monkeypatch.setattr(settings, "poster_hash_secret", "test-poster-hash-secret")
    monkeypatch.setattr(
        settings,
        "poster_confirmation_secret",
        "test-poster-confirmation-secret",
    )


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
    mock_qr = _mock_qr(
        id="test-qr-1", destination_type="custom-url", destination_id="https://example.com"
    )

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


def test_resolve_new_standard_qr_requires_location(client):
    """A never-scanned standard poster still requires first-scan location."""
    mock_qr = _mock_qr(
        id="new-standard",
        destination_type="event",
        destination_id="42",
        latest_scan=None,
    )

    def mock_get(qr_code_id):
        return mock_qr if qr_code_id == "new-standard" else None

    original_get = qr_code_service.get_qr_code_by_id
    qr_code_service.get_qr_code_by_id = MagicMock(side_effect=mock_get)
    try:
        resp = client.get("/qr/new-standard")
        assert resp.status_code == 400
        assert resp.json()["detail"] == "requires_location"
    finally:
        qr_code_service.get_qr_code_by_id = original_get


def test_resolve_archived_qr_redirects_without_recording(client):
    """Archived posters remain useful links but do not create scans."""
    mock_qr = _mock_qr(
        id="archived",
        destination_type="event",
        destination_id="99",
        is_active=False,
    )

    def mock_get(qr_code_id):
        return mock_qr if qr_code_id == "archived" else None

    original_get = qr_code_service.get_qr_code_by_id
    original_record = qr_code_service.record_scan
    qr_code_service.get_qr_code_by_id = MagicMock(side_effect=mock_get)
    qr_code_service.record_scan = MagicMock()
    try:
        resp = client.get("/qr/archived")
        assert resp.status_code == 200
        data = resp.json()
        assert data["destination_type"] == "event"
        assert data["destination_id"] == 99
        qr_code_service.record_scan.assert_not_called()
    finally:
        qr_code_service.get_qr_code_by_id = original_get
        qr_code_service.record_scan = original_record


def test_promoter_scan_returns_attribution_and_confirmation_token(client, monkeypatch):
    monkeypatch.setattr(settings, "poster_visitor_cookie_path", "/api/qr")
    promoter = _mock_qr(
        id="promoter-scan",
        program="promoter",
        destination_type="events-list",
    )
    monkeypatch.setattr(
        qr_code_service,
        "get_qr_code_by_id",
        MagicMock(return_value=promoter),
    )
    monkeypatch.setattr(
        qr_code_service,
        "record_scan",
        MagicMock(return_value=SimpleNamespace(id=uuid4())),
    )

    response = client.get("/qr/promoter-scan")

    assert response.status_code == 200
    assert response.json()["query_params"] == {
        "utm_source": "poster",
        "poster_id": "promoter-scan",
    }
    assert response.json()["scan_confirmation_token"]
    assert qr_code_service.POSTER_VISITOR_COOKIE in response.cookies
    assert "Path=/api/qr" in response.headers["set-cookie"]


def test_scan_confirmation_requires_matching_visitor_cookie(client, monkeypatch):
    confirm = MagicMock(
        return_value=QrScanConfirmResponse(
            confirmed=True,
            landing_confirmed_at=datetime.now(timezone.utc),
        )
    )
    monkeypatch.setattr(qr_code_service, "confirm_scan", confirm)

    missing_cookie = client.post("/qr/scans/confirm", json={"token": "signed-token"})
    assert missing_cookie.status_code == 400

    client.cookies.set(qr_code_service.POSTER_VISITOR_COOKIE, "visitor-token", path="/qr")
    confirmed = client.post("/qr/scans/confirm", json={"token": "signed-token"})
    assert confirmed.status_code == 200
    assert confirmed.json()["confirmed"] is True
    assert confirm.call_args.kwargs["visitor_token"] == "visitor-token"


# ── Ownership tests ─────────────────────────────────────────────────────


def test_create_poster_sets_created_by(admin_client, monkeypatch):
    """create_poster stamps created_by from the authenticated admin."""
    qr = _mock_qr()
    mock_create = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "create_qr_code", mock_create)

    resp = admin_client.post(
        "/qr/",
        json={
            "id": "test-qr",
            "name": "Test",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert str(kwargs["creator"].id) == ADMIN_USER["id"]


@pytest.mark.parametrize("field,value", [("created_by", "attacker-id"), ("is_active", True)])
def test_create_poster_rejects_server_owned_fields(admin_client, field, value):
    """Server-owned fields are rejected instead of silently ignored."""
    payload = {
        "id": f"stale-client-qr-{field}",
        "name": "Stale Client",
        "destination_type": "custom-url",
        field: value,
    }
    resp = admin_client.post(
        "/qr/",
        json=payload,
    )
    assert resp.status_code == 422


# ── URL validation for custom-url destination type ─────────────────────


def test_create_poster_rejects_javascript_url(admin_client):
    """POST /qr/ with javascript: URL returns 422."""
    resp = admin_client.post(
        "/qr/",
        json={
            "id": "xss-qr",
            "name": "XSS",
            "destination_type": "custom-url",
            "destination_id": "javascript:alert(1)",
        },
    )
    assert resp.status_code == 422


def test_create_poster_rejects_data_url(admin_client):
    """POST /qr/ with data: URL returns 422."""
    resp = admin_client.post(
        "/qr/",
        json={
            "id": "data-qr",
            "name": "Data",
            "destination_type": "custom-url",
            "destination_id": "data:text/html,<script>alert(1)</script>",
        },
    )
    assert resp.status_code == 422


def test_create_poster_accepts_https_url(admin_client, monkeypatch):
    """POST /qr/ with a valid https URL succeeds."""
    qr = _mock_qr(destination_id="https://example.com")
    mock_create = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "create_qr_code", mock_create)

    resp = admin_client.post(
        "/qr/",
        json={
            "id": "safe-qr",
            "name": "Safe",
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
        },
    )
    assert resp.status_code == 201


def test_update_poster_rejects_javascript_url(admin_client, monkeypatch):
    """PATCH /qr/{id} with javascript: URL returns 422."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    resp = admin_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Hacked",
            "destination_type": "custom-url",
            "destination_id": "javascript:alert(document.cookie)",
        },
    )
    assert resp.status_code == 422


def test_create_poster_allows_custom_url_without_destination_id(admin_client, monkeypatch):
    """POST /qr/ with custom-url but no destination_id (null) is allowed."""
    qr = _mock_qr()
    mock_create = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "create_qr_code", mock_create)

    resp = admin_client.post(
        "/qr/",
        json={
            "id": "null-url-qr",
            "name": "No URL",
            "destination_type": "custom-url",
            "destination_id": None,
        },
    )
    assert resp.status_code == 201


# ── Regression: audit U5 — POST must not allow hijacking an existing poster ──


def test_create_poster_refuses_to_hijack_existing_id(admin_client, monkeypatch):
    """POST /qr/ with an id that already exists returns 409, not silent upsert.

    Audit U5: previously this handler called ``upsert_qr_code`` which did
    a blind update if the row existed.  Any caller could guess / observe
    another poster id and POST a new destination to hijack it.  The fix
    splits create vs update — POST inserts only.  The admin-only lockdown
    (Phase 4) further narrows the attack surface but the 409 guard stays
    independent of role since two admins could race on the same id.
    """
    existing = _mock_qr(id="victim-qr", created_by=OTHER_USER["id"])
    # create_qr_code performs the existence check itself by calling
    # get_qr_code_by_id — mock it to return the pre-existing row.
    monkeypatch.setattr(
        qr_code_service,
        "get_qr_code_by_id",
        MagicMock(return_value=existing),
    )

    resp = admin_client.post(
        "/qr/",
        json={
            "id": "victim-qr",
            "name": "Hijack attempt",
            "destination_type": "custom-url",
            "destination_id": "https://evil.example",
        },
    )
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"].lower()


# ── Regression: audit U11 — QrCodeCreate field size caps ───────────────


def test_create_poster_rejects_oversized_name(admin_client):
    """POST /qr/ with a 10 MB name is rejected by Pydantic (422)."""
    resp = admin_client.post(
        "/qr/",
        json={
            "id": "normal-id",
            "name": "x" * 10_000_000,
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
        },
    )
    assert resp.status_code == 422


def test_create_poster_rejects_oversized_description(admin_client):
    """POST /qr/ with a huge description is rejected (422)."""
    resp = admin_client.post(
        "/qr/",
        json={
            "id": "normal-id",
            "name": "ok",
            "description": "x" * 10_000_000,
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
        },
    )
    assert resp.status_code == 422


def test_create_poster_rejects_oversized_id(admin_client):
    """POST /qr/ with a 100k-char id is rejected (422)."""
    resp = admin_client.post(
        "/qr/",
        json={
            "id": "x" * 100_000,
            "name": "ok",
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
        },
    )
    assert resp.status_code == 422


# ── Non-admin enforcement (Phase 4 lockdown) ────────────────────────────


def test_create_poster_non_admin_rejected(authenticated_client):
    """POST /qr/ from a non-admin returns 403."""
    resp = authenticated_client.post(
        "/qr/",
        json={
            "id": "non-admin-attempt",
            "name": "Nope",
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
        },
    )
    assert resp.status_code == 403


def test_enrolled_promoter_can_create_promoter_poster(authenticated_client, monkeypatch):
    enrolled = make_db_user(
        FAKE_USER,
        school="University of Waterloo",
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=datetime.now(timezone.utc),
        promoter_tos_version="2026-01",
    )
    monkeypatch.setattr(
        user_service,
        "get_user_by_supabase_id",
        MagicMock(return_value=enrolled),
    )
    created = _mock_qr(
        id="promoter-qr",
        program="promoter",
        created_by=FAKE_USER["id"],
        destination_type="events-list",
    )
    create = MagicMock(return_value=created)
    monkeypatch.setattr(qr_code_service, "create_qr_code", create)

    response = authenticated_client.post(
        "/qr/",
        json={
            "id": "promoter-qr",
            "name": "Promoter QR",
            "destination_type": "events-list",
            "program": "promoter",
        },
    )

    assert response.status_code == 201
    assert response.json()["program"] == "promoter"
    assert create.call_args.kwargs["creator"] == enrolled


def test_promoter_create_rejects_non_feed_destination(authenticated_client, monkeypatch):
    enrolled = make_db_user(
        FAKE_USER,
        school="University of Waterloo",
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=datetime.now(timezone.utc),
        promoter_tos_version="2026-01",
    )
    monkeypatch.setattr(
        user_service,
        "get_user_by_supabase_id",
        MagicMock(return_value=enrolled),
    )

    response = authenticated_client.post(
        "/qr/",
        json={
            "id": "promoter-qr",
            "name": "Promoter QR",
            "destination_type": "custom-url",
            "destination_id": "https://example.com",
            "program": "promoter",
        },
    )

    assert response.status_code == 422


def test_update_poster_non_admin_rejected(authenticated_client, monkeypatch):
    """PATCH /qr/{id} from a non-admin returns 403, even on their own QR.

    Non-admins should never reach update — admin-only is checked before
    ownership. The dependency rejects the request before the route body
    runs, so the service layer is not exercised here.
    """
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock())
    resp = authenticated_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Nope",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 403


def test_delete_poster_non_admin_rejected(authenticated_client, monkeypatch):
    """DELETE /qr/{id} from a non-admin returns 403."""
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock())
    resp = authenticated_client.delete("/qr/test-qr")
    assert resp.status_code == 403


def test_delete_poster_admin_allowed(admin_client, monkeypatch):
    """Admin can delete a QR code."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "delete_qr_code", MagicMock())

    resp = admin_client.delete("/qr/test-qr")
    assert resp.status_code == 204


def test_owner_can_archive_promoter_poster(authenticated_client, monkeypatch):
    existing = _mock_qr(program="promoter", created_by=FAKE_USER["id"])
    archived = _mock_qr(
        program="promoter",
        created_by=FAKE_USER["id"],
        is_active=False,
    )
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    archive = MagicMock(return_value=archived)
    monkeypatch.setattr(qr_code_service, "archive_qr_code", archive)

    response = authenticated_client.post("/qr/test-qr/archive")

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    archive.assert_called_once_with("test-qr")


# ── 401 without auth ────────────────────────────────────────────────────


def test_create_poster_requires_auth(client):
    """POST /qr/ returns 401 without auth."""
    resp = client.post("/qr/", json={"id": "x", "name": "X", "destination_type": "custom-url"})
    assert resp.status_code == 401


def test_update_poster_requires_auth(client):
    """PATCH /qr/{id} returns 401 without auth."""
    resp = client.patch(
        "/qr/test-qr", json={"id": "test-qr", "name": "X", "destination_type": "custom-url"}
    )
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


def test_list_qr_codes_non_admin_rejected(authenticated_client):
    """GET /qr/ from a non-admin returns 403 (admin-only listing)."""
    resp = authenticated_client.get("/qr/")
    assert resp.status_code == 403


def test_list_qr_codes_admin_sees_all(admin_client, monkeypatch):
    """Admin sees all QR codes (no created_by filter)."""
    all_qrs = [
        _mock_qr(created_by=FAKE_USER["id"]),
        _mock_qr(id="other-qr", created_by=OTHER_USER["id"]),
    ]
    mock_list = MagicMock(return_value=(all_qrs, 2))
    monkeypatch.setattr(qr_code_service, "list_qr_codes", mock_list)

    from services import user_service

    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user())
    )

    resp = admin_client.get("/qr/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["total"] == 2
    # Admin: called without created_by filter (only offset/limit kwargs)
    _, kwargs = mock_list.call_args
    assert "created_by" not in kwargs


def test_list_scans_non_admin_rejected(authenticated_client):
    """GET /qr/scans from a non-admin returns 403 (admin-only analytics)."""
    resp = authenticated_client.get("/qr/scans")
    assert resp.status_code == 403


def test_list_scans_admin_sees_all(admin_client, monkeypatch):
    """Admin scans have owned_by=None (sees all)."""
    mock_list = MagicMock(return_value=([], 0))
    monkeypatch.setattr(qr_code_service, "list_scans", mock_list)

    from services import user_service

    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user())
    )

    resp = admin_client.get("/qr/scans")
    assert resp.status_code == 200
    _, kwargs = mock_list.call_args
    assert kwargs["owned_by"] is None


def test_get_promoter_earnings_delegates_to_service(authenticated_client, monkeypatch):
    earnings = PromoterEarningsResponse(
        period="2026-07",
        posters=[],
        period_creditable_scans=0,
        pending_cents=0,
        lifetime_paid_cents=0,
        active_slots_used=0,
        active_slots_limit=50,
        program_enabled=True,
    )
    get_earnings = MagicMock(return_value=earnings)
    monkeypatch.setattr(poster_payout_service, "get_promoter_earnings", get_earnings)

    response = authenticated_client.get("/qr/earnings")

    assert response.status_code == 200
    assert response.json()["active_slots_limit"] == 50
    get_earnings.assert_called_once()


# ── Owner can update (success) ──────────────────────────────────────────


def test_update_poster_admin_allowed(admin_client, monkeypatch):
    """Admin can update any QR code (admin-only endpoint, ownership-agnostic)."""
    existing = _mock_qr(created_by=FAKE_USER["id"])
    updated = _mock_qr(name="Updated Name", created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "update_qr_code", MagicMock(return_value=updated))

    resp = admin_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Updated Name",
            "destination_type": "custom-url",
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
    monkeypatch.setattr(qr_code_service, "update_qr_code", MagicMock(return_value=updated))

    from services import user_service

    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user())
    )

    resp = admin_client.patch(
        "/qr/test-qr",
        json={
            "id": "test-qr",
            "name": "Admin Fix",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 200


def test_admin_can_delete_non_owned_qr(admin_client, monkeypatch):
    """Admin can delete a QR code they don't own."""
    existing = _mock_qr(created_by=OTHER_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "delete_qr_code", MagicMock())

    from services import user_service

    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=_admin_db_user())
    )

    resp = admin_client.delete("/qr/test-qr")
    assert resp.status_code == 204


# ── QR scan rate limiting ────────────────────────────────────────────────


def test_qr_scan_rate_limit_triggers_429(client):
    """Exceeding the QR scan rate limit returns 429 with Retry-After header."""
    mock_qr = _mock_qr(
        id="rate-test", destination_type="custom-url", destination_id="https://example.com"
    )
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
    mock_qr = _mock_qr(
        id="ok-test", destination_type="custom-url", destination_id="https://example.com"
    )
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


# ── Organization Owner authorization and filter tests ──────────────────────────


def test_organization_owner_can_list_own_qr_codes(organization_owner_client, monkeypatch):
    """Organization owner can list their own QR codes, which applies created_by filter."""
    my_qr = _mock_qr(id="my-qr", created_by=FAKE_USER["id"])
    mock_list = MagicMock(return_value=([my_qr], 1))
    monkeypatch.setattr(qr_code_service, "list_qr_codes", mock_list)

    resp = organization_owner_client.get("/qr/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == "my-qr"

    _, kwargs = mock_list.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_organization_owner_can_list_own_scans(organization_owner_client, monkeypatch):
    """Organization owner can list scans, which applies owned_by filter."""
    mock_list = MagicMock(return_value=([], 0))
    monkeypatch.setattr(qr_code_service, "list_scans", mock_list)

    resp = organization_owner_client.get("/qr/scans")
    assert resp.status_code == 200

    _, kwargs = mock_list.call_args
    assert kwargs["owned_by"] == FAKE_USER["id"]


def test_organization_owner_can_create_poster(organization_owner_client, monkeypatch):
    """Organization owner can create a QR code, which enforces created_by as their id."""
    qr = _mock_qr(created_by=FAKE_USER["id"])
    mock_create = MagicMock(return_value=qr)
    monkeypatch.setattr(qr_code_service, "create_qr_code", mock_create)

    resp = organization_owner_client.post(
        "/qr/",
        json={
            "id": "new-qr",
            "name": "New QR",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert str(kwargs["creator"].id) == FAKE_USER["id"]


def test_organization_owner_can_update_own_poster(organization_owner_client, monkeypatch):
    """Organization owner can update a poster they created."""
    existing = _mock_qr(id="my-qr", created_by=FAKE_USER["id"])
    updated = _mock_qr(id="my-qr", name="Updated", created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "update_qr_code", MagicMock(return_value=updated))

    resp = organization_owner_client.patch(
        "/qr/my-qr",
        json={
            "id": "my-qr",
            "name": "Updated",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


def test_organization_owner_cannot_update_other_poster(organization_owner_client, monkeypatch):
    """Organization owner cannot update a poster created by another user."""
    existing = _mock_qr(id="other-qr", created_by=OTHER_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    resp = organization_owner_client.patch(
        "/qr/other-qr",
        json={
            "id": "other-qr",
            "name": "Hack Attempt",
            "destination_type": "custom-url",
        },
    )
    assert resp.status_code == 403


def test_organization_owner_can_delete_own_poster(organization_owner_client, monkeypatch):
    """Organization owner can delete their own poster."""
    existing = _mock_qr(id="my-qr", created_by=FAKE_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))
    monkeypatch.setattr(qr_code_service, "delete_qr_code", MagicMock())

    resp = organization_owner_client.delete("/qr/my-qr")
    assert resp.status_code == 204


def test_organization_owner_cannot_delete_other_poster(organization_owner_client, monkeypatch):
    """Organization owner cannot delete a poster created by another user."""
    existing = _mock_qr(id="other-qr", created_by=OTHER_USER["id"])
    monkeypatch.setattr(qr_code_service, "get_qr_code_by_id", MagicMock(return_value=existing))

    resp = organization_owner_client.delete("/qr/other-qr")
    assert resp.status_code == 403
