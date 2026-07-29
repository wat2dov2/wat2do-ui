"""Event submission persistence and moderation workflow."""

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
from services import event_service, organization_service, school_service

log = logging.getLogger(__name__)

_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    SUBMISSION_PENDING: frozenset({SUBMISSION_APPROVED, SUBMISSION_REJECTED}),
    SUBMISSION_APPROVED: frozenset(),
    SUBMISSION_REJECTED: frozenset(),
}


def _fetch_user_email(user_id: str | None) -> str | None:
    if user_id is None:
        return None
    try:
        user_row = get_sb().table("users").select("email").eq("id", user_id).execute()
        if user_row.data and isinstance(user_row.data, list) and len(user_row.data) > 0:
            first_row = user_row.data[0]
            if isinstance(first_row, dict):
                email = first_row.get("email")
                if isinstance(email, str):
                    return email
    except Exception as e:
        log.warning("Failed to fetch user email for %s: %s", user_id, e)
    return None


def create_submission(user_id: str | None, event_data: EventCreate | dict) -> SubmissionResponse:
    event_dict = (
        event_data.model_dump(mode="json", exclude_none=True)
        if isinstance(event_data, EventCreate)
        else event_data
    )
    organization_id = event_dict.get("organization_id")
    organization = (
        organization_service.get_organization(int(organization_id))
        if organization_id is not None
        else None
    )
    if organization is None or organization.school_id is None:
        raise ValidationError("Submission organization school is not registered")
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_data": event_dict,
        "school_id": organization.school_id,
        "status": SUBMISSION_PENDING,
    }
    r = get_sb().table(EVENT_SUBMISSIONS).insert(payload).execute()
    if r.data:
        email = _fetch_user_email(user_id)
        return SubmissionResponse.model_validate({**r.data[0], "submitted_by_email": email})
    log.warning("Insert returned no data for create_submission(user_id=%s)", user_id)
    return SubmissionResponse(**payload, submitted_at=datetime.now(timezone.utc).isoformat())


def get_submissions(
    status: str | None = None,
    school: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[SubmissionResponse], int]:
    q = get_sb().table(EVENT_SUBMISSIONS).select("*, users(email)", count="exact")
    if status:
        q = q.eq("status", status)
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        q = q.eq("school_id", school_id)
    q = q.order("submitted_at", desc=True)
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = []
    for row in r.data or []:
        email = None
        if "users" in row and isinstance(row["users"], dict):
            email = row["users"].get("email")
        model_data = {**row, "submitted_by_email": email}
        items.append(SubmissionResponse.model_validate(model_data))
    return items, r.count or len(items)


def get_submission_by_id(submission_id: str) -> SubmissionResponse | None:
    r = (
        get_sb()
        .table(EVENT_SUBMISSIONS)
        .select("*, users(email)")
        .eq("id", submission_id)
        .execute()
    )
    if not r.data:
        return None
    row = r.data[0]
    email = None
    if "users" in row and isinstance(row["users"], dict):
        email = row["users"].get("email")
    model_data = {**row, "submitted_by_email": email}
    return SubmissionResponse.model_validate(model_data)


def update_submission(
    submission_id: str,
    status: str,
    rejection_reason: str | None = None,
    *,
    reviewed_by: str | None = None,
) -> SubmissionResponse | None:
    """Move a submission through moderation.

    Approving publishes the event server-side. That keeps the admin UI from
    owning a hidden "create event after status change" side effect.
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

    if existing.status == status:
        return existing

    created_event_id: int | None = None
    if status == SUBMISSION_APPROVED:
        event_data = EventCreate.model_validate(existing.event_data)
        created_event = event_service.create_event(
            event_data,
            created_by=reviewed_by or existing.user_id,
        )
        created_event_id = created_event.id

    payload: dict = {
        "status": status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if rejection_reason is not None:
        payload["rejection_reason"] = rejection_reason

    r = get_sb().table(EVENT_SUBMISSIONS).update(payload).eq("id", submission_id).execute()
    if not r.data and created_event_id is not None:
        try:
            event_service.delete_event(created_event_id)
        except Exception:
            log.warning(
                "Failed to clean up event created for submission=%s after status update returned no rows",
                submission_id,
                exc_info=True,
            )
    if r.data:
        email = _fetch_user_email(r.data[0].get("user_id"))
        return SubmissionResponse.model_validate({**r.data[0], "submitted_by_email": email})
    return None


def delete_submission(submission_id: str) -> bool:
    r = get_sb().table(EVENT_SUBMISSIONS).delete().eq("id", submission_id).execute()
    return bool(r.data)
