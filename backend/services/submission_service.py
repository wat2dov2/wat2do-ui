"""Event submission persistence."""

import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.tables import EVENT_SUBMISSIONS
from schemas.submission import SubmissionResponse


def create_submission(user_id: str, event_data: dict) -> SubmissionResponse:
    """Create a new event submission."""
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_data": event_data,
        "status": "pending",
    }
    r = get_sb().table(EVENT_SUBMISSIONS).insert(payload).execute()
    return SubmissionResponse.model_validate(r.data[0]) if r.data else SubmissionResponse(**payload)


def get_submissions(status: str | None = None) -> list[SubmissionResponse]:
    """Return submissions, optionally filtered by status."""
    q = get_sb().table(EVENT_SUBMISSIONS).select("*")
    if status:
        q = q.eq("status", status)
    r = q.order("submitted_at", desc=True).execute()
    return [SubmissionResponse.model_validate(row) for row in (r.data or [])]


def get_submission_by_id(submission_id: str) -> SubmissionResponse | None:
    """Return a single submission by ID."""
    r = (
        get_sb()
        .table(EVENT_SUBMISSIONS)
        .select("*")
        .eq("id", submission_id)
        .execute()
    )
    return SubmissionResponse.model_validate(r.data[0]) if r.data else None


def update_submission(
    submission_id: str,
    status: str,
    rejection_reason: str | None = None,
) -> SubmissionResponse | None:
    """Update a submission's status."""
    payload: dict = {
        "status": status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if rejection_reason is not None:
        payload["rejection_reason"] = rejection_reason

    r = (
        get_sb()
        .table(EVENT_SUBMISSIONS)
        .update(payload)
        .eq("id", submission_id)
        .execute()
    )
    return SubmissionResponse.model_validate(r.data[0]) if r.data else None


def delete_submission(submission_id: str) -> bool:
    """Delete a submission. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(EVENT_SUBMISSIONS)
        .delete()
        .eq("id", submission_id)
        .execute()
    )
    return bool(r.data)
