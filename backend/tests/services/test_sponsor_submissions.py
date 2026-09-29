from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.exceptions import ConflictError, NotFoundError, ValidationError
from schemas.sponsor_submission import SponsorSubmissionCreate
from services import sponsor_submission_service as service

DATA = {
    "email": "student@example.com",
    "message": "Needs support",
    "school": "uwaterloo",
    "business_name": "Campus Cafe",
}
ROW = {
    **DATA,
    "id": "77777777-7777-4777-8777-777777777771",
    "school_id": 1,
    "school_record": {"slug": "uwaterloo"},
    "status": "pending",
    "submitted_at": "2026-09-29T00:00:00Z",
}


def test_creation_resolves_school_and_stores_pending(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.sponsor_submission_service")
    monkeypatch.setattr(service.school_service, "get_school_id", lambda school: 1)
    fake_sb.set_response(data=[ROW])
    result = service.create_submission(SponsorSubmissionCreate(**DATA))
    assert result.status == "pending"
    payload = fake_sb.insert.call_args.args[0]
    assert payload == {
        "email": DATA["email"],
        "message": DATA["message"],
        "school_id": 1,
        "business_name": DATA["business_name"],
        "status": "pending",
    }


def test_unknown_school_and_empty_insert_do_not_accept(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.sponsor_submission_service")
    monkeypatch.setattr(service.school_service, "get_school_id", lambda school: None)
    with pytest.raises(ValidationError):
        service.create_submission(SponsorSubmissionCreate(**DATA))
    fake_sb.insert.assert_not_called()
    monkeypatch.setattr(service.school_service, "get_school_id", lambda school: 1)
    fake_sb.set_response(data=[])
    with pytest.raises(RuntimeError):
        service.create_submission(SponsorSubmissionCreate(**DATA))


def test_list_uses_database_count_and_school_scope(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.sponsor_submission_service")
    monkeypatch.setattr(service.school_service, "get_school_id", lambda school: 1)
    fake_sb.set_response(data=[ROW], count=42)
    items, total = service.list_submissions(
        status="pending", school="uwaterloo", search="Cafe", offset=10, limit=10
    )
    assert total == 42 and items[0].school == "uwaterloo"
    fake_sb.eq.assert_any_call("status", "pending")
    fake_sb.eq.assert_any_call("school_id", 1)
    fake_sb.range.assert_called_once_with(10, 19)
    fake_sb.ilike.assert_called_once_with("business_name", "%Cafe%")


@pytest.mark.parametrize(
    "existing, error", [([{"id": ROW["id"]}], ConflictError), ([], NotFoundError)]
)
def test_concurrent_review_cannot_overwrite_completed_decision(fake_sb, patch_sb, existing, error):
    patch_sb("services.sponsor_submission_service")
    fake_sb.execute = Mock(side_effect=[SimpleNamespace(data=[]), SimpleNamespace(data=existing)])
    with pytest.raises(error):
        service.review_submission(ROW["id"], "rejected", "reviewer-id")
    fake_sb.eq.assert_any_call("status", "pending")


def test_review_records_reviewer_and_returns_updated_submission(fake_sb, patch_sb):
    patch_sb("services.sponsor_submission_service")
    fake_sb.execute = Mock(
        side_effect=[
            SimpleNamespace(data=[ROW]),
            SimpleNamespace(data={**ROW, "status": "approved"}),
        ]
    )
    result = service.review_submission(ROW["id"], "approved", "reviewer-id")
    assert result.status == "approved"
    payload = fake_sb.update.call_args.args[0]
    assert payload["reviewed_by"] == "reviewer-id"
    assert payload["reviewed_at"]
