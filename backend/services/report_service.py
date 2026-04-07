"""Reported events persistence."""

import uuid
from datetime import datetime, timezone

from core.database import get_sb
from schemas.report import ReportResponse


def create_report(user_id: str, event_id: int, reason: str) -> ReportResponse:
    """Create a new event report."""
    payload = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "user_id": user_id,
        "reason": reason,
        "status": "pending",
    }
    r = get_sb().table("reported_events").insert(payload).execute()
    return ReportResponse.model_validate(r.data[0]) if r.data else ReportResponse(**payload)


def get_reports(status: str | None = None) -> list[ReportResponse]:
    """Return reports, optionally filtered by status."""
    q = get_sb().table("reported_events").select("*")
    if status:
        q = q.eq("status", status)
    r = q.order("reported_at", desc=True).execute()
    return [ReportResponse.model_validate(row) for row in (r.data or [])]


def update_report(report_id: str, status: str) -> ReportResponse | None:
    """Update a report's status."""
    payload: dict = {
        "status": status,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }
    r = (
        get_sb()
        .table("reported_events")
        .update(payload)
        .eq("id", report_id)
        .execute()
    )
    return ReportResponse.model_validate(r.data[0]) if r.data else None
