"""Reported events persistence."""

import logging
import uuid
from datetime import datetime, timezone

from core.constants import DEFAULT_LIST_LIMIT, REPORT_DISMISSED, REPORT_PENDING, REPORT_RESOLVED
from core.database import get_sb
from core.errors import EVENT_NOT_FOUND, INVALID_STATUS_TRANSITION
from core.exceptions import NotFoundError, ValidationError
from core.tables import REPORTED_EVENTS
from schemas.report import ReportResponse

log = logging.getLogger(__name__)


# Allowed state transitions for reports.  Only ``pending`` can progress
# forward; ``resolved`` and ``dismissed`` are terminal so ``resolved_at``
# stays stable once set (audit I5 / E6).
_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    REPORT_PENDING: frozenset({REPORT_RESOLVED, REPORT_DISMISSED}),
    REPORT_RESOLVED: frozenset(),
    REPORT_DISMISSED: frozenset(),
}


def _event_exists(event_id: int) -> bool:
    """Return True if an events row with *event_id* exists.

    Kept here (not in event_service) to avoid a circular-import cycle
    during service bootstrap and because the check is internal to the
    report create flow.
    """
    # Lazy import to avoid circular dependency at module load
    from services import event_service

    return event_service.get_event(event_id) is not None


def create_report(user_id: str, event_id: int, reason: str) -> ReportResponse:
    """Create a new event report.

    Verifies the referenced event exists before inserting — stops the
    forged-event-id DoS vector flagged in audit I2.  The FK migration
    DB foreign keys enforce this at the storage layer as well; this check keeps the error message clean
    (404 instead of opaque ``Referenced resource does not exist``).
    """
    if not _event_exists(event_id):
        raise NotFoundError(EVENT_NOT_FOUND)

    payload = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "user_id": user_id,
        "reason": reason,
        "status": REPORT_PENDING,
    }
    r = get_sb().table(REPORTED_EVENTS).insert(payload).execute()
    if r.data:
        return ReportResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for create_report(user_id=%s, event_id=%s), using payload fallback",
        user_id,
        event_id,
    )
    return ReportResponse(**payload, reported_at=datetime.now(timezone.utc).isoformat())


def get_reports(
    status: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = DEFAULT_LIST_LIMIT,
) -> tuple[list[ReportResponse], int]:
    """Return reports, optionally filtered by status.

    Returns (items, total_count).  Pass ``limit=None`` only for trusted
    internal maintenance callers that intentionally need all rows.
    """
    q = get_sb().table(REPORTED_EVENTS).select("*", count="exact")
    if status:
        q = q.eq("status", status)
    q = q.order("reported_at", desc=True)
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = [ReportResponse.model_validate(row) for row in (r.data or [])]
    return items, r.count or len(items)


def _get_report_by_id(report_id: str) -> ReportResponse | None:
    r = get_sb().table(REPORTED_EVENTS).select("*").eq("id", report_id).execute()
    return ReportResponse.model_validate(r.data[0]) if r.data else None


def update_report(report_id: str, status: str) -> ReportResponse | None:
    """Update a report's status.

    - Transitions out of terminal states (``resolved``, ``dismissed``) are
      rejected with ``ValidationError`` (audit I5).
    - ``resolved_at`` is set exactly once: when the report first transitions
      out of ``pending`` to a terminal state.  If the report was already
      terminal it stays idempotent (no-op); the field is never reset
      (audit E6).
    """
    existing = _get_report_by_id(report_id)
    if existing is None:
        return None
    allowed = _ALLOWED_TRANSITIONS.get(existing.status, frozenset())
    if status not in allowed and status != existing.status:
        log.warning(
            "Rejected report transition %s: %s -> %s (allowed: %s)",
            report_id,
            existing.status,
            status,
            sorted(allowed),
        )
        raise ValidationError(INVALID_STATUS_TRANSITION)

    payload: dict = {"status": status}
    # Only stamp resolved_at when transitioning *out of* pending for the
    # first time — preserves the original resolution timestamp across any
    # (defensive, now-rejected) re-openings.
    if existing.status == REPORT_PENDING and status != REPORT_PENDING:
        payload["resolved_at"] = datetime.now(timezone.utc).isoformat()

    r = get_sb().table(REPORTED_EVENTS).update(payload).eq("id", report_id).execute()
    return ReportResponse.model_validate(r.data[0]) if r.data else None
