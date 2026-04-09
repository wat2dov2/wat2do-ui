"""Reported events persistence."""

import uuid
from datetime import datetime, timezone

from constants import REPORT_PENDING
from core.database import get_sb
from core.tables import REPORTED_EVENTS
from schemas.report import ReportResponse


def create_report(user_id: str, event_id: int, reason: str) -> ReportResponse:
    """Create a new event report."""
    payload = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "user_id": user_id,
        "reason": reason,
        "status": REPORT_PENDING,
    }
    r = get_sb().table(REPORTED_EVENTS).insert(payload).execute()
    return ReportResponse.model_validate(r.data[0]) if r.data else ReportResponse(**payload)


def get_reports(
    status: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[ReportResponse], int]:
    """Return reports, optionally filtered by status.

    Returns (items, total_count).  When *limit* is None the query is
    unbounded (legacy behaviour for non-paginated callers).
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


def update_report(report_id: str, status: str) -> ReportResponse | None:
    """Update a report's status."""
    payload: dict = {
        "status": status,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }
    r = (
        get_sb()
        .table(REPORTED_EVENTS)
        .update(payload)
        .eq("id", report_id)
        .execute()
    )
    return ReportResponse.model_validate(r.data[0]) if r.data else None
