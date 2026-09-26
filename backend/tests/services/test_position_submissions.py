from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.exceptions import ValidationError
from schemas.position import PositionCreate
from schemas.submission import PositionSubmissionResponse
from services import submission_service

DATA = {
    "club_id": 7,
    "title": "Design Lead",
    "description": "Design posters",
    "position_type": "committee",
    "source_url": "https://example.com/role",
    "is_paid": True,
}


def row(status="pending"):
    return {
        "id": "00000000-0000-4000-9000-000000000001",
        "user_id": None,
        "school_id": 99,
        "position_data": DATA,
        "status": status,
        "submitted_at": "2026-09-09T12:00:00Z",
    }


def test_creation_derives_school_from_club(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.submission_service")
    monkeypatch.setattr(
        submission_service.club_service,
        "get_club",
        lambda _id: SimpleNamespace(school_id=99),
    )
    fake_sb.set_response(data=[row()])
    result = submission_service.create_submission(None, PositionCreate(**DATA), kind="position")
    assert result.position_data.is_paid is True
    fake_sb.table.assert_called_with("position_submissions")
    assert fake_sb.insert.call_args.args[0]["school_id"] == 99
    assert "event_data" not in fake_sb.insert.call_args.args[0]


def test_creation_does_not_report_success_without_inserted_row(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.submission_service")
    monkeypatch.setattr(
        submission_service.club_service,
        "get_club",
        lambda _id: SimpleNamespace(school_id=99),
    )
    fake_sb.set_response(data=[])
    with pytest.raises(RuntimeError, match="Submission insert returned no row"):
        submission_service.create_submission(None, PositionCreate(**DATA), kind="position")


def test_list_disambiguates_submitter_from_reviewer(fake_sb, patch_sb):
    patch_sb("services.submission_service")
    fake_sb.set_response(
        data=[
            {
                **row(),
                "school_record": {"slug": "ulaval"},
                "users": {"email": "student@example.com"},
            }
        ]
    )
    items, _ = submission_service.get_submissions(kind="position")
    fake_sb.select.assert_called_once_with(
        f"*, users!user_id(email), {submission_service.school_service.SCHOOL_SLUG_EMBED}",
        count="exact",
    )
    assert items[0].submitted_by_email == "student@example.com"
    assert items[0].school == "ulaval"


def test_list_filters_title_and_school_before_pagination(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.submission_service")
    monkeypatch.setattr(submission_service.school_service, "get_school_id", lambda _: 99)
    fake_sb.set_response(data=[])
    submission_service.get_submissions(
        kind="position", school="ulaval", search=" Design ", offset=20, limit=20
    )
    fake_sb.eq.assert_called_with("school_id", 99)
    fake_sb.ilike.assert_called_once_with("position_data->>title", "%Design%")
    fake_sb.range.assert_called_once_with(20, 39)


def test_approval_uses_one_atomic_rpc(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.submission_service")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        lambda *args, **kwargs: PositionSubmissionResponse(**row()),
    )
    monkeypatch.setattr(submission_service.club_service, "get_club", lambda _id: None)
    fake_sb.set_response(data=[row("approved")])
    result = submission_service.review_position_submission(
        row()["id"], "approved", None, reviewed_by="admin"
    )
    assert result.status == "approved"
    fake_sb.rpc.assert_called_once_with(
        "review_position_submission",
        {"p_id": row()["id"], "p_status": "approved", "p_reason": None, "p_reviewer": "admin"},
    )
    fake_sb.insert.assert_not_called()


def test_terminal_submission_cannot_be_reopened(monkeypatch):
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        lambda *args, **kwargs: PositionSubmissionResponse(**row("approved")),
    )
    database = Mock()
    monkeypatch.setattr(submission_service, "get_sb", database)
    with pytest.raises(ValidationError):
        submission_service.review_position_submission(
            row()["id"], "pending", None, reviewed_by="admin"
        )
    database.assert_not_called()


def test_approved_position_refreshes_positions_and_clubs_after_commit(
    fake_sb, patch_sb, monkeypatch
):
    from services.event_feed_revalidation import event_feed_revalidation_service

    patch_sb("services.submission_service")
    monkeypatch.setattr(
        submission_service,
        "get_submission_by_id",
        lambda *args, **kwargs: PositionSubmissionResponse(**row()),
    )
    monkeypatch.setattr(
        submission_service.club_service,
        "get_club",
        lambda _id: SimpleNamespace(id=7, school="uwaterloo"),
    )
    fake_sb.set_response(data=[row("approved")])
    refresh = Mock(side_effect=lambda *args, **kwargs: fake_sb.execute.assert_called_once())
    monkeypatch.setattr(event_feed_revalidation_service, "revalidate_school", refresh)

    submission_service.review_position_submission(
        row()["id"], "approved", None, reviewed_by="admin"
    )

    refresh.assert_called_once_with("uwaterloo", resources=("positions", "clubs"))
