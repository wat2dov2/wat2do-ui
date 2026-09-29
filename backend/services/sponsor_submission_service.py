"""Persist nominations separately from ordinary contact mail and moderate once."""

from datetime import datetime, timezone

from core.database import get_sb
from core.errors import (
    INVALID_STATUS_TRANSITION,
    SPONSOR_SUBMISSION_NOT_FOUND,
    SUBMISSION_SCHOOL_REQUIRED,
)
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.sanitize import sanitize_postgrest_value
from core.tables import SPONSOR_SUBMISSIONS
from schemas.sponsor_submission import SponsorSubmissionCreate, SponsorSubmissionResponse
from services import school_service


def _response(row: dict) -> SponsorSubmissionResponse:
    data = school_service.with_school_slug(row)
    return SponsorSubmissionResponse.model_validate(
        {key: data.get(key) for key in SponsorSubmissionResponse.model_fields}
    )


def create_submission(data: SponsorSubmissionCreate) -> SponsorSubmissionResponse:
    school_id = school_service.get_school_id(data.school)
    if school_id is None:
        raise ValidationError(SUBMISSION_SCHOOL_REQUIRED)
    payload = data.model_dump(mode="json", exclude={"school"})
    result = (
        get_sb()
        .table(SPONSOR_SUBMISSIONS)
        .insert({**payload, "school_id": school_id, "status": "pending"})
        .execute()
    )
    if not result.data:
        raise RuntimeError("Sponsor submission insert returned no row")
    return SponsorSubmissionResponse.model_validate(
        {
            **data.model_dump(),
            **{k: result.data[0].get(k) for k in ("id", "status", "submitted_at", "reviewed_at")},
        }
    )


def list_submissions(
    *, status: str | None, school: str | None, search: str | None, offset: int, limit: int
):
    query = (
        get_sb()
        .table(SPONSOR_SUBMISSIONS)
        .select(f"*, {school_service.SCHOOL_SLUG_EMBED}", count="exact")
    )
    if status:
        query = query.eq("status", status)
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if search and search.strip():
        query = query.ilike("business_name", f"%{sanitize_postgrest_value(search.strip())}%")
    result = (
        query.order("submitted_at", desc=True)
        .order("id")
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [_response(row) for row in result.data or []], result.count or 0


def review_submission(submission_id: str, status: str, reviewer: str) -> SponsorSubmissionResponse:
    # The pending predicate makes competing reviews atomic: only one can win.
    result = (
        get_sb()
        .table(SPONSOR_SUBMISSIONS)
        .update(
            {
                "status": status,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "reviewed_by": reviewer,
            }
        )
        .eq("id", submission_id)
        .eq("status", "pending")
        .execute()
    )
    if not result.data:
        existing = (
            get_sb().table(SPONSOR_SUBMISSIONS).select("id").eq("id", submission_id).execute()
        )
        if not existing.data:
            raise NotFoundError(SPONSOR_SUBMISSION_NOT_FOUND)
        raise ConflictError(INVALID_STATUS_TRANSITION)
    row = (
        get_sb()
        .table(SPONSOR_SUBMISSIONS)
        .select(f"*, {school_service.SCHOOL_SLUG_EMBED}")
        .eq("id", submission_id)
        .single()
        .execute()
    )
    return _response(row.data)
