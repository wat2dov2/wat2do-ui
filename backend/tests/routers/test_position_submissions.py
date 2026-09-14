from datetime import datetime, timezone
from unittest.mock import Mock

import pytest

from routers.position_submissions import _limiter
from schemas.submission import PositionSubmissionResponse
from services import submission_service


@pytest.fixture(autouse=True)
def reset_rate_limit():
    _limiter._requests.clear()
    yield
    _limiter._requests.clear()


POSITION = {
    "club_id": 7,
    "title": "Design Lead",
    "description": "Lead the design team.",
    "position_type": "committee",
    "is_paid": None,
    "source_url": "https://example.com/jobs/design",
}
SUBMISSION_ID = "00000000-0000-4000-9000-000000000001"


def submission(status="pending"):
    return PositionSubmissionResponse(
        id=SUBMISSION_ID,
        user_id=None,
        position_data=POSITION,
        status=status,
        submitted_at=datetime.now(timezone.utc),
    )


def test_create_requires_authentication(client):
    assert (
        client.post("/position-submissions/", json={"position_data": POSITION}).status_code == 401
    )


def test_authenticated_creation_uses_position_resource(authenticated_client, monkeypatch):
    create = Mock(return_value=submission())
    monkeypatch.setattr(submission_service, "create_submission", create)
    response = authenticated_client.post("/position-submissions/", json={"position_data": POSITION})
    assert response.status_code == 201
    assert response.json()["position_data"]["is_paid"] is None
    assert create.call_args.kwargs == {"kind": "position"}
    assert create.call_args.args[0] is not None


@pytest.mark.parametrize(
    "changes",
    [
        {"source_url": "javascript:alert(1)"},
        {"source_image_url": "file:///secret"},
        {"title": "  "},
        {"club_id": 0},
        {"school": "wrong-school"},
        {"deadline_at": "2026-09-09T12:00:00Z"},
    ],
)
def test_rejects_invalid_or_ignored_fields(authenticated_client, changes):
    response = authenticated_client.post(
        "/position-submissions/", json={"position_data": {**POSITION, **changes}}
    )
    assert response.status_code == 422


def test_regular_user_cannot_list_or_review(authenticated_client):
    assert authenticated_client.get("/position-submissions/").status_code == 403
    assert (
        authenticated_client.patch(
            "/position-submissions/" + SUBMISSION_ID, json={"status": "approved"}
        ).status_code
        == 403
    )


def test_admin_lists_every_school_by_default(admin_client, monkeypatch):
    get = Mock(return_value=([submission()], 1))
    monkeypatch.setattr(submission_service, "get_submissions", get)
    response = admin_client.get("/position-submissions/")
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert get.call_args.kwargs["school"] is None
    assert get.call_args.kwargs["kind"] == "position"


def test_admin_passes_school_and_search_to_listing(admin_client, monkeypatch):
    get = Mock(return_value=([], 0))
    monkeypatch.setattr(submission_service, "get_submissions", get)
    response = admin_client.get("/position-submissions/?school=ulaval&search=Design&page=2")
    assert response.status_code == 200
    assert get.call_args.kwargs["school"] == "ulaval"
    assert get.call_args.kwargs["search"] == "Design"
    assert get.call_args.kwargs["offset"] > 0


@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_admin_reviews_on_server(admin_client, monkeypatch, status):
    review = Mock(return_value=submission(status))
    monkeypatch.setattr(submission_service, "review_position_submission", review)
    response = admin_client.patch("/position-submissions/" + SUBMISSION_ID, json={"status": status})
    assert response.status_code == 200
    assert review.call_args.args == (SUBMISSION_ID, status, None)
    assert review.call_args.kwargs["reviewed_by"]
