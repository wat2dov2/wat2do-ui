from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.submission import SubmissionResponse
from schemas.user import UserResponse
from services import submission_service, user_service
from tests.conftest import FAKE_USER, ADMIN_USER


FAKE_DB_USER = UserResponse(
    id="00000000-0000-0000-0000-000000000001",
    email=FAKE_USER["email"],
    role="user",
    created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)


def _mock_submission(**overrides) -> SubmissionResponse:
    defaults = {
        "id": "sub-001",
        "user_id": str(FAKE_DB_USER.id),
        "event_data": {"title": "Test Event", "location": "Test Loc"},
        "status": "pending",
        "rejection_reason": None,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
    }
    defaults.update(overrides)
    return SubmissionResponse.model_validate(defaults)


# ---------------------------------------------------------------------------
# POST /submissions/ -- requires get_current_user (any authenticated user)
# ---------------------------------------------------------------------------

_VALID_EVENT_DATA = {
    "title": "X",
    "location": "Loc",
    "organization": "Org",
}


def test_create_submission_requires_auth(client):
    """POST /submissions/ without auth returns 401."""
    resp = client.post("/submissions/", json={"event_data": _VALID_EVENT_DATA})
    assert resp.status_code == 401


def test_create_submission_authenticated(authenticated_client, monkeypatch):
    """POST /submissions/ with auth returns 201."""
    submission = _mock_submission()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=FAKE_DB_USER))
    monkeypatch.setattr(submission_service, "create_submission", MagicMock(return_value=submission))

    resp = authenticated_client.post("/submissions/", json={"event_data": _VALID_EVENT_DATA})
    assert resp.status_code == 201
    assert resp.json()["id"] == "sub-001"


# ---------------------------------------------------------------------------
# GET /submissions/ -- requires get_admin_user, returns paginated response
# ---------------------------------------------------------------------------

def test_list_submissions_requires_auth(client):
    """GET /submissions/ without auth returns 401."""
    resp = client.get("/submissions/")
    assert resp.status_code == 401


def test_list_submissions_forbidden_for_non_admin(authenticated_client):
    """GET /submissions/ as regular user returns 403."""
    resp = authenticated_client.get("/submissions/")
    assert resp.status_code == 403


def test_list_submissions_admin(admin_client, monkeypatch):
    """GET /submissions/ as admin returns paginated 200."""
    monkeypatch.setattr(
        submission_service, "get_submissions",
        MagicMock(return_value=([_mock_submission()], 1)),
    )

    resp = admin_client.get("/submissions/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert body["total_pages"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == "sub-001"


def test_list_submissions_with_pagination_params(admin_client, monkeypatch):
    """GET /submissions/?page=2&page_size=10 passes correct offset/limit."""
    mock_fn = MagicMock(return_value=([], 25))
    monkeypatch.setattr(submission_service, "get_submissions", mock_fn)

    resp = admin_client.get("/submissions/?page=2&page_size=10")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 25
    assert body["page"] == 2
    assert body["page_size"] == 10
    assert body["total_pages"] == 3
    assert len(body["items"]) == 0
    # Verify the service was called with correct offset/limit
    _, kwargs = mock_fn.call_args
    assert kwargs["offset"] == 10
    assert kwargs["limit"] == 10


def test_list_submissions_default_pagination(admin_client, monkeypatch):
    """GET /submissions/ without params uses defaults (page=1, page_size=50)."""
    mock_fn = MagicMock(return_value=([], 0))
    monkeypatch.setattr(submission_service, "get_submissions", mock_fn)

    resp = admin_client.get("/submissions/")
    assert resp.status_code == 200
    _, kwargs = mock_fn.call_args
    assert kwargs["offset"] == 0
    assert kwargs["limit"] == 50


# ---------------------------------------------------------------------------
# GET /submissions/{id} -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_get_submission_requires_auth(client):
    """GET /submissions/{id} without auth returns 401."""
    resp = client.get("/submissions/sub-001")
    assert resp.status_code == 401


def test_get_submission_forbidden_for_non_admin(authenticated_client):
    """GET /submissions/{id} as regular user returns 403."""
    resp = authenticated_client.get("/submissions/sub-001")
    assert resp.status_code == 403


def test_get_submission_admin(admin_client, monkeypatch):
    """GET /submissions/{id} as admin returns 200."""
    monkeypatch.setattr(submission_service, "get_submission_by_id", MagicMock(return_value=_mock_submission()))

    resp = admin_client.get("/submissions/sub-001")
    assert resp.status_code == 200
    assert resp.json()["id"] == "sub-001"


# ---------------------------------------------------------------------------
# PATCH /submissions/{id} -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_update_submission_requires_auth(client):
    """PATCH /submissions/{id} without auth returns 401."""
    resp = client.patch("/submissions/sub-001", json={"status": "approved"})
    assert resp.status_code == 401


def test_update_submission_forbidden_for_non_admin(authenticated_client):
    """PATCH /submissions/{id} as regular user returns 403."""
    resp = authenticated_client.patch("/submissions/sub-001", json={"status": "approved"})
    assert resp.status_code == 403


def test_update_submission_admin(admin_client, monkeypatch):
    """PATCH /submissions/{id} as admin returns 200."""
    updated = _mock_submission(status="approved")
    monkeypatch.setattr(submission_service, "update_submission", MagicMock(return_value=updated))

    resp = admin_client.patch("/submissions/sub-001", json={"status": "approved"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


# ---------------------------------------------------------------------------
# DELETE /submissions/{id} -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_delete_submission_requires_auth(client):
    """DELETE /submissions/{id} without auth returns 401."""
    resp = client.delete("/submissions/sub-001")
    assert resp.status_code == 401


def test_delete_submission_forbidden_for_non_admin(authenticated_client):
    """DELETE /submissions/{id} as regular user returns 403."""
    resp = authenticated_client.delete("/submissions/sub-001")
    assert resp.status_code == 403


def test_delete_submission_admin(admin_client, monkeypatch):
    """DELETE /submissions/{id} as admin returns 204."""
    monkeypatch.setattr(submission_service, "delete_submission", MagicMock(return_value=True))

    resp = admin_client.delete("/submissions/sub-001")
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Status-transition state machine (audit I4)
# ---------------------------------------------------------------------------


def test_submission_service_rejects_terminal_to_pending(monkeypatch):
    """submission_service.update_submission rejects approved -> pending."""
    from core.exceptions import ValidationError

    existing = _mock_submission(status="approved")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        MagicMock(return_value=existing),
    )

    try:
        submission_service.update_submission("sub-001", "pending")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError for approved -> pending")


def test_submission_service_rejects_rejected_to_approved(monkeypatch):
    """submission_service.update_submission rejects rejected -> approved."""
    from core.exceptions import ValidationError

    existing = _mock_submission(status="rejected")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        MagicMock(return_value=existing),
    )

    try:
        submission_service.update_submission("sub-001", "approved")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError for rejected -> approved")


def test_submission_service_allows_pending_to_approved(monkeypatch):
    """submission_service.update_submission allows pending -> approved."""
    existing = _mock_submission(status="pending")
    approved = _mock_submission(status="approved")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        MagicMock(return_value=existing),
    )

    # Mock the DB call so the test doesn't actually hit Supabase
    mock_sb = MagicMock()
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [
        approved.model_dump()
    ]
    monkeypatch.setattr("services.submission_service.get_sb", lambda: mock_sb)

    result = submission_service.update_submission("sub-001", "approved")
    assert result is not None
    assert result.status == "approved"
