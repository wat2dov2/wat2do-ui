from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.submission import SubmissionResponse
from schemas.user import UserResponse
from services import event_service, submission_service, user_service
from tests.conftest import FAKE_USER

FAKE_DB_USER = UserResponse(
    id="00000000-0000-0000-0000-000000000001",
    email=FAKE_USER["email"],
    role="user",
    created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)

_VALID_EVENT_DATA = {
    "title": "X",
    "location": "Loc",
    "organization": "Org",
    "club_id": 7,
    "occurrences": [
        {
            "dtstart_utc": "2026-12-01T18:00:00+00:00",
            "dtend_utc": "2026-12-01T20:00:00+00:00",
            "duration": None,
            "tz": "America/Toronto",
        }
    ],
}


def _mock_submission(**overrides) -> SubmissionResponse:
    defaults = {
        "id": "sub-001",
        "user_id": str(FAKE_DB_USER.id),
        "event_data": _VALID_EVENT_DATA,
        "status": "pending",
        "rejection_reason": None,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
    }
    defaults.update(overrides)
    return SubmissionResponse.model_validate(defaults)


def test_create_submission_requires_auth(client):
    resp = client.post("/submissions/", json={"event_data": _VALID_EVENT_DATA})
    assert resp.status_code == 401


def test_create_submission_authenticated(authenticated_client, monkeypatch):
    submission = _mock_submission()
    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=FAKE_DB_USER)
    )
    monkeypatch.setattr(submission_service, "create_submission", MagicMock(return_value=submission))

    resp = authenticated_client.post("/submissions/", json={"event_data": _VALID_EVENT_DATA})

    assert resp.status_code == 201
    assert resp.json()["id"] == "sub-001"


def test_list_submissions_forbidden_for_non_admin(authenticated_client):
    resp = authenticated_client.get("/submissions/")
    assert resp.status_code == 403


def test_list_submissions_admin(admin_client, monkeypatch):
    monkeypatch.setattr(
        submission_service,
        "get_submissions",
        MagicMock(return_value=([_mock_submission()], 1)),
    )

    resp = admin_client.get("/submissions/")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert len(body["items"]) == 1


def test_update_submission_admin_approves_with_reviewer(admin_client, monkeypatch):
    updated = _mock_submission(status="approved")
    mock_update = MagicMock(return_value=updated)
    monkeypatch.setattr(submission_service, "update_submission", mock_update)

    resp = admin_client.patch("/submissions/sub-001", json={"status": "approved"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    _, kwargs = mock_update.call_args
    assert kwargs["reviewed_by"] == "33333333-3333-3333-3333-333333333333"


def test_delete_submission_admin(admin_client, monkeypatch):
    monkeypatch.setattr(submission_service, "delete_submission", MagicMock(return_value=True))

    resp = admin_client.delete("/submissions/sub-001")

    assert resp.status_code == 204


def test_submission_service_rejects_terminal_to_pending(monkeypatch):
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


def test_submission_service_approval_publishes_event(monkeypatch):
    existing = _mock_submission(status="pending")
    approved = _mock_submission(status="approved")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        MagicMock(return_value=existing),
    )
    mock_create_event = MagicMock()
    monkeypatch.setattr(event_service, "create_event", mock_create_event)

    mock_sb = MagicMock()
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [
        approved.model_dump()
    ]
    monkeypatch.setattr("services.submission_service.get_sb", lambda: mock_sb)

    result = submission_service.update_submission(
        "sub-001",
        "approved",
        reviewed_by="33333333-3333-3333-3333-333333333333",
    )

    assert result is not None
    assert result.status == "approved"
    mock_create_event.assert_called_once()
    _, kwargs = mock_create_event.call_args
    assert kwargs["created_by"] == "33333333-3333-3333-3333-333333333333"
