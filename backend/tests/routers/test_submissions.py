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

def test_create_submission_requires_auth(client):
    """POST /submissions/ without auth returns 401."""
    resp = client.post("/submissions/", json={"event_data": {"title": "X"}})
    assert resp.status_code == 401


def test_create_submission_authenticated(authenticated_client, monkeypatch):
    """POST /submissions/ with auth returns 201."""
    submission = _mock_submission()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=FAKE_DB_USER))
    monkeypatch.setattr(submission_service, "create_submission", MagicMock(return_value=submission))

    resp = authenticated_client.post("/submissions/", json={"event_data": {"title": "X"}})
    assert resp.status_code == 201
    assert resp.json()["id"] == "sub-001"


# ---------------------------------------------------------------------------
# GET /submissions/ -- requires get_admin_user
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
    """GET /submissions/ as admin returns 200."""
    monkeypatch.setattr(submission_service, "get_submissions", MagicMock(return_value=[_mock_submission()]))

    resp = admin_client.get("/submissions/")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


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
