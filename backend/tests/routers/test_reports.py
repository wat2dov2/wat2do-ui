from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.report import ReportResponse
from schemas.user import UserResponse
from services import report_service, user_service
from tests.conftest import FAKE_USER, ADMIN_USER


FAKE_DB_USER = UserResponse(
    id="00000000-0000-0000-0000-000000000001",
    email=FAKE_USER["email"],
    role="user",
    created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)


def _mock_report(**overrides) -> ReportResponse:
    defaults = {
        "id": "rpt-001",
        "event_id": 42,
        "user_id": str(FAKE_DB_USER.id),
        "reason": "Spam event",
        "status": "pending",
        "reported_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
    }
    defaults.update(overrides)
    return ReportResponse.model_validate(defaults)


# ---------------------------------------------------------------------------
# POST /reports/ -- requires get_current_user (any authenticated user)
# ---------------------------------------------------------------------------

def test_create_report_requires_auth(client):
    """POST /reports/ without auth returns 401."""
    resp = client.post("/reports/", json={"event_id": 42, "reason": "Spam"})
    assert resp.status_code == 401


def test_create_report_authenticated(authenticated_client, monkeypatch):
    """POST /reports/ with auth returns 201."""
    report = _mock_report()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=FAKE_DB_USER))
    monkeypatch.setattr(report_service, "create_report", MagicMock(return_value=report))

    resp = authenticated_client.post("/reports/", json={"event_id": 42, "reason": "Spam"})
    assert resp.status_code == 201
    assert resp.json()["id"] == "rpt-001"


# ---------------------------------------------------------------------------
# GET /reports/ -- requires get_admin_user, returns paginated response
# ---------------------------------------------------------------------------

def test_list_reports_requires_auth(client):
    """GET /reports/ without auth returns 401."""
    resp = client.get("/reports/")
    assert resp.status_code == 401


def test_list_reports_forbidden_for_non_admin(authenticated_client):
    """GET /reports/ as regular user returns 403."""
    resp = authenticated_client.get("/reports/")
    assert resp.status_code == 403


def test_list_reports_admin(admin_client, monkeypatch):
    """GET /reports/ as admin returns paginated 200."""
    monkeypatch.setattr(
        report_service, "get_reports",
        MagicMock(return_value=([_mock_report()], 1)),
    )

    resp = admin_client.get("/reports/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert body["total_pages"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == "rpt-001"


def test_list_reports_with_pagination_params(admin_client, monkeypatch):
    """GET /reports/?page=3&page_size=20 passes correct offset/limit."""
    mock_fn = MagicMock(return_value=([], 55))
    monkeypatch.setattr(report_service, "get_reports", mock_fn)

    resp = admin_client.get("/reports/?page=3&page_size=20")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 55
    assert body["page"] == 3
    assert body["page_size"] == 20
    assert body["total_pages"] == 3
    _, kwargs = mock_fn.call_args
    assert kwargs["offset"] == 40
    assert kwargs["limit"] == 20


# ---------------------------------------------------------------------------
# PATCH /reports/{id} -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_update_report_requires_auth(client):
    """PATCH /reports/{id} without auth returns 401."""
    resp = client.patch("/reports/rpt-001", json={"status": "resolved"})
    assert resp.status_code == 401


def test_update_report_forbidden_for_non_admin(authenticated_client):
    """PATCH /reports/{id} as regular user returns 403."""
    resp = authenticated_client.patch("/reports/rpt-001", json={"status": "resolved"})
    assert resp.status_code == 403


def test_update_report_admin(admin_client, monkeypatch):
    """PATCH /reports/{id} as admin returns 200."""
    updated = _mock_report(status="resolved")
    monkeypatch.setattr(report_service, "update_report", MagicMock(return_value=updated))

    resp = admin_client.patch("/reports/rpt-001", json={"status": "resolved"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"


# ---------------------------------------------------------------------------
# POST /reports/ — event existence check (audit I2)
# ---------------------------------------------------------------------------


def test_create_report_rejects_nonexistent_event(authenticated_client, monkeypatch):
    """POST /reports/ returns 404 when event_id references a missing event."""
    from services import event_service

    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=FAKE_DB_USER))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=None))

    resp = authenticated_client.post("/reports/", json={"event_id": 99999, "reason": "Spam"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Status-transition state machine (audit I5 / E6)
# ---------------------------------------------------------------------------


def test_report_service_rejects_terminal_to_pending(monkeypatch):
    """report_service.update_report rejects resolved -> pending."""
    from core.exceptions import ValidationError

    existing = _mock_report(status="resolved")
    monkeypatch.setattr(
        report_service,
        "_get_report_by_id",
        MagicMock(return_value=existing),
    )

    try:
        report_service.update_report("rpt-001", "pending")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError for resolved -> pending")


def test_report_service_rejects_dismissed_to_resolved(monkeypatch):
    """report_service.update_report rejects dismissed -> resolved."""
    from core.exceptions import ValidationError

    existing = _mock_report(status="dismissed")
    monkeypatch.setattr(
        report_service,
        "_get_report_by_id",
        MagicMock(return_value=existing),
    )

    try:
        report_service.update_report("rpt-001", "resolved")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError for dismissed -> resolved")
