"""Event and position submission persistence and moderation workflows."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from core.constants import SUBMISSION_APPROVED, SUBMISSION_PENDING, SUBMISSION_REJECTED
from core.database import get_sb
from core.errors import (
    INVALID_STATUS_TRANSITION,
    POSITION_ALREADY_EXISTS,
    SUBMISSION_SCHOOL_REQUIRED,
)
from core.exceptions import ValidationError
from core.sanitize import sanitize_postgrest_value
from core.tables import EVENT_SUBMISSIONS, POSITION_SUBMISSIONS
from schemas.event import EventCreate
from schemas.position import PositionCreate
from schemas.submission import PositionSubmissionResponse, SubmissionResponse
from services import club_service, event_service, school_service

log = logging.getLogger(__name__)

SubmissionKind = Literal["event", "position"]


def _resource(kind: SubmissionKind):
    return (
        (EVENT_SUBMISSIONS, "event_data", SubmissionResponse)
        if kind == "event"
        else (POSITION_SUBMISSIONS, "position_data", PositionSubmissionResponse)
    )


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


def create_submission(
    user_id: str | None,
    event_data: EventCreate | PositionCreate | dict,
    *,
    kind: SubmissionKind = "event",
):
    table, data_field, response_model = _resource(kind)
    event_dict = (
        event_data.model_dump(mode="json", exclude_none=True)
        if isinstance(event_data, (EventCreate, PositionCreate))
        else event_data
    )
    club_id = event_dict.get("club_id")
    club = club_service.get_club(int(club_id)) if club_id is not None else None
    if club is None or club.school_id is None:
        raise ValidationError(SUBMISSION_SCHOOL_REQUIRED)
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        data_field: event_dict,
        "school_id": club.school_id,
        "status": SUBMISSION_PENDING,
    }
    r = get_sb().table(table).insert(payload).execute()
    if r.data:
        email = _fetch_user_email(user_id)
        return response_model.model_validate({**r.data[0], "submitted_by_email": email})
    raise RuntimeError("Submission insert returned no row")


def get_submissions(
    status: str | None = None,
    school: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = None,
    kind: SubmissionKind = "event",
    search: str | None = None,
):
    table, data_field, response_model = _resource(kind)
    q = (
        get_sb()
        .table(table)
        .select(f"*, users!user_id(email), {school_service.SCHOOL_SLUG_EMBED}", count="exact")
    )
    if search and search.strip():
        q = q.ilike(f"{data_field}->>title", f"%{sanitize_postgrest_value(search.strip())}%")
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
        model_data = {**school_service.with_school_slug(row), "submitted_by_email": email}
        items.append(response_model.model_validate(model_data))
    return items, r.count or len(items)


def get_submission_by_id(submission_id: str, *, kind: SubmissionKind = "event"):
    table, _, response_model = _resource(kind)
    r = get_sb().table(table).select("*, users!user_id(email)").eq("id", submission_id).execute()
    if not r.data:
        return None
    row = r.data[0]
    email = None
    if "users" in row and isinstance(row["users"], dict):
        email = row["users"].get("email")
    model_data = {**row, "submitted_by_email": email}
    return response_model.model_validate(model_data)


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


def review_position_submission(
    submission_id: str, status: str, rejection_reason: str | None, *, reviewed_by: str
):
    from postgrest.exceptions import APIError

    from services.event_feed_revalidation import event_feed_revalidation_service

    existing = get_submission_by_id(submission_id, kind="position")
    if existing is None:
        return None
    if status != existing.status and status not in _ALLOWED_TRANSITIONS[existing.status]:
        raise ValidationError(INVALID_STATUS_TRANSITION)
    # Validate the stored payload again before the transaction publishes it.
    PositionCreate.model_validate(existing.position_data)
    try:
        result = (
            get_sb()
            .rpc(
                "review_position_submission",
                {
                    "p_id": submission_id,
                    "p_status": status,
                    "p_reason": rejection_reason,
                    "p_reviewer": reviewed_by,
                },
            )
            .execute()
        )
    except APIError as exc:
        if exc.code == "23514":
            raise ValidationError(INVALID_STATUS_TRANSITION) from exc
        if exc.code == "23505":
            raise ValidationError(POSITION_ALREADY_EXISTS) from exc
        raise
    if not result.data:
        return None
    if status == SUBMISSION_APPROVED:
        club = club_service.get_club(existing.position_data.club_id)
        if club:
            event_feed_revalidation_service.revalidate_school(club.school)
    return PositionSubmissionResponse.model_validate(
        {
            **result.data[0],
            "submitted_by_email": existing.submitted_by_email,
        }
    )


def delete_submission(submission_id: str) -> bool:
    r = get_sb().table(EVENT_SUBMISSIONS).delete().eq("id", submission_id).execute()
    return bool(r.data)
