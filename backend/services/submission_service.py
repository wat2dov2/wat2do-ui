"""Event submission persistence."""

import logging
import uuid
from datetime import datetime, timezone

from core.constants import SUBMISSION_APPROVED, SUBMISSION_PENDING, SUBMISSION_REJECTED
from core.database import get_sb
from core.errors import INVALID_STATUS_TRANSITION
from core.exceptions import ValidationError
from core.tables import EVENT_SUBMISSIONS
from schemas.event import EventCreate
from schemas.submission import SubmissionResponse

log = logging.getLogger(__name__)


# Allowed status transitions.  Terminal states (approved, rejected) cannot
# be revisited.  Any admin that wants to reverse a decision must create a
# new submission — the append-only audit trail is the design contract.
_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    SUBMISSION_PENDING: frozenset({SUBMISSION_APPROVED, SUBMISSION_REJECTED}),
    SUBMISSION_APPROVED: frozenset(),
    SUBMISSION_REJECTED: frozenset(),
}


def create_submission(user_id: str, event_data: EventCreate | dict) -> SubmissionResponse:
    """Create a new event submission.

    Accepts either a validated ``EventCreate`` (new router path) or a
    raw ``dict`` (legacy callers / tests that predate audit S1).  The
    dict form is normalised via ``model_dump(mode="json")`` so JSONB
    storage receives ISO timestamps, not raw ``datetime`` objects.
    """
    event_dict = (
        event_data.model_dump(mode="json", exclude_none=True)
        if isinstance(event_data, EventCreate)
        else event_data
    )
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_data": event_dict,
        "status": SUBMISSION_PENDING,
    }
    r = get_sb().table(EVENT_SUBMISSIONS).insert(payload).execute()
    if r.data:
        return SubmissionResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for create_submission(user_id=%s), using payload fallback", user_id
    )
    return SubmissionResponse(**payload, submitted_at=datetime.now(timezone.utc).isoformat())


def get_submissions(
    status: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[SubmissionResponse], int]:
    """Return submissions, optionally filtered by status.

    Returns (items, total_count).  When *limit* is None the query is
    unbounded (legacy behaviour for non-paginated callers).
    """
    q = get_sb().table(EVENT_SUBMISSIONS).select("*", count="exact")
    if status:
        q = q.eq("status", status)
    q = q.order("submitted_at", desc=True)
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = [SubmissionResponse.model_validate(row) for row in (r.data or [])]
    return items, r.count or len(items)


def get_submission_by_id(submission_id: str) -> SubmissionResponse | None:
    """Return a single submission by ID."""
    r = get_sb().table(EVENT_SUBMISSIONS).select("*").eq("id", submission_id).execute()
    return SubmissionResponse.model_validate(r.data[0]) if r.data else None


def update_submission(
    submission_id: str,
    status: str,
    rejection_reason: str | None = None,
) -> SubmissionResponse | None:
    """Update a submission's status.

    Enforces a simple state machine: ``pending`` is the only state from
    which transitions are allowed; ``approved`` and ``rejected`` are
    terminal.  Attempts to transition out of a terminal state raise
    ``ValidationError`` (audit I4).
    """
    existing = get_submission_by_id(submission_id)
    if existing is None:
        return None
    allowed = _ALLOWED_TRANSITIONS.get(existing.status, frozenset())
    if status not in allowed and status != existing.status:
        log.warning(
            "Rejected submission transition %s: %s -> %s (allowed: %s)",
            submission_id,
            existing.status,
            status,
            sorted(allowed),
        )
        raise ValidationError(INVALID_STATUS_TRANSITION)

    payload: dict = {
        "status": status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if rejection_reason is not None:
        payload["rejection_reason"] = rejection_reason

    r = get_sb().table(EVENT_SUBMISSIONS).update(payload).eq("id", submission_id).execute()
    return SubmissionResponse.model_validate(r.data[0]) if r.data else None


def delete_submission(submission_id: str) -> bool:
    """Delete a submission. Returns True if a row was deleted."""
    r = get_sb().table(EVENT_SUBMISSIONS).delete().eq("id", submission_id).execute()
    return bool(r.data)
