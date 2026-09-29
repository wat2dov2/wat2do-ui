from unittest.mock import Mock

import pytest

from core.exceptions import ConflictError, ValidationError
from routers.sponsor_submissions import _limiter
from schemas.sponsor_submission import SponsorSubmissionResponse
from services import sponsor_submission_service as service

ID = "77777777-7777-4777-8777-777777777771"
DATA = {
    "email": "student@example.com",
    "message": "Needs support",
    "school": "uwaterloo",
    "business_name": "Campus Cafe",
}


def submission(status="pending"):
    return SponsorSubmissionResponse(
        **DATA, id=ID, status=status, submitted_at="2026-09-29T00:00:00Z"
    )


@pytest.fixture(autouse=True)
def reset_limit():
    _limiter._requests.clear()
    yield
    _limiter._requests.clear()


def test_public_submission_persists_before_email(client, monkeypatch):
    operations = []
    monkeypatch.setattr(
        service, "create_submission", lambda data: operations.append(("persist", data))
    )
    monkeypatch.setattr(
        "routers.sponsor_submissions.email_service.send_safely",
        lambda message: operations.append(("email", message)),
    )
    response = client.post("/sponsor-submissions/", json=DATA)
    assert response.status_code == 201
    assert [kind for kind, _ in operations] == ["persist", "email"]
    assert operations[0][1].school == "uwaterloo"
    assert "email" not in response.json()


def test_persistence_failure_never_reports_success_or_sends_email(client, monkeypatch):
    monkeypatch.setattr(
        service, "create_submission", Mock(side_effect=ValidationError("Unknown school"))
    )
    dispatch = Mock()
    monkeypatch.setattr("routers.sponsor_submissions.email_service.send_safely", dispatch)
    response = client.post("/sponsor-submissions/", json=DATA)
    assert response.status_code == 400
    dispatch.assert_not_called()


@pytest.mark.parametrize(
    "changes", [{"email": "bad"}, {"business_name": "  "}, {"school": ""}, {"status": "approved"}]
)
def test_invalid_or_client_controlled_review_data_is_rejected(client, changes):
    assert client.post("/sponsor-submissions/", json={**DATA, **changes}).status_code == 422


@pytest.mark.parametrize("fixture, expected", [("client", 401), ("authenticated_client", 403)])
def test_queue_and_review_require_admin(request, fixture, expected):
    session = request.getfixturevalue(fixture)
    assert session.get("/sponsor-submissions/").status_code == expected
    assert (
        session.patch(f"/sponsor-submissions/{ID}", json={"status": "approved"}).status_code
        == expected
    )


def test_admin_queue_forwards_filters_and_exact_pending_total(admin_client, monkeypatch):
    listing = Mock(return_value=([submission()], 37))
    monkeypatch.setattr(service, "list_submissions", listing)
    response = admin_client.get(
        "/sponsor-submissions/?submission_status=pending&school=uwaterloo&search=Cafe&page=2&page_size=10"
    )
    assert response.status_code == 200
    assert response.json()["total"] == 37
    listing.assert_called_once_with(
        status="pending", school="uwaterloo", search="Cafe", offset=10, limit=10
    )


def test_admin_review_and_conflict(admin_client, monkeypatch):
    review = Mock(return_value=submission("approved"))
    monkeypatch.setattr(service, "review_submission", review)
    assert (
        admin_client.patch(f"/sponsor-submissions/{ID}", json={"status": "approved"}).status_code
        == 200
    )
    assert review.call_args.args[:2] == (ID, "approved")
    assert review.call_args.args[2]
    review.side_effect = ConflictError("Already reviewed")
    assert (
        admin_client.patch(f"/sponsor-submissions/{ID}", json={"status": "rejected"}).status_code
        == 409
    )
    assert (
        admin_client.patch(f"/sponsor-submissions/{ID}", json={"status": "pending"}).status_code
        == 422
    )


def test_public_submission_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(service, "create_submission", Mock(return_value=submission()))
    monkeypatch.setattr("routers.sponsor_submissions.email_service.send_safely", Mock())
    monkeypatch.setattr(_limiter, "max_requests", 1)
    assert client.post("/sponsor-submissions/", json=DATA).status_code == 201
    assert client.post("/sponsor-submissions/", json=DATA).status_code == 429
