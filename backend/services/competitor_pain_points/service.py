"""Store what the sweep finds and serve it to the admin page."""

from __future__ import annotations

from datetime import datetime

from core.database import get_sb
from core.errors import COMPETITOR_PAIN_POINT_NOT_FOUND
from core.exceptions import NotFoundError
from core.sanitize import sanitize_postgrest_value
from core.tables import COMPETITOR_PAIN_POINT_REPORTS, COMPETITOR_PAIN_POINTS
from schemas.competitor_pain_point import (
    CompetitorPainPointResponse,
    DailyReport,
    DailyReportResponse,
    FoundPainPoint,
)


def list_pain_points(
    *,
    competitor: str | None,
    source: str | None,
    audience: str | None,
    status: str | None,
    search: str | None,
    offset: int,
    limit: int,
) -> tuple[list[CompetitorPainPointResponse], int]:
    query = get_sb().table(COMPETITOR_PAIN_POINTS).select("*", count="exact")
    for column, value in (
        ("competitor", competitor),
        ("source", source),
        ("audience", audience),
        ("status", status),
    ):
        if value:
            query = query.eq(column, value)
    if search and search.strip():
        term = sanitize_postgrest_value(search.strip())
        query = query.or_(f"quote.ilike.%{term}%,pain_point.ilike.%{term}%")
    result = (
        query.order("found_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    )
    rows = [CompetitorPainPointResponse.model_validate(row) for row in result.data or []]
    return rows, result.count or 0


def review_pain_point(pain_point_id: str, status: str) -> CompetitorPainPointResponse:
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINTS)
        .update({"status": status})
        .eq("id", pain_point_id)
        .execute()
    )
    if not result.data:
        raise NotFoundError(COMPETITOR_PAIN_POINT_NOT_FOUND)
    return CompetitorPainPointResponse.model_validate(result.data[0])


def recent_urls(limit: int) -> list[str]:
    """Links already stored, newest first, so the agent skips what it has seen."""
    if limit == 0:
        return []
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINTS)
        .select("url")
        .order("found_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [row["url"] for row in result.data or []]


def save_findings(findings: list[FoundPainPoint]) -> int:
    """Insert new complaints; a link already stored keeps its row and admin status."""
    if not findings:
        return 0
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINTS)
        .upsert(
            [finding.model_dump(mode="json") for finding in findings],
            on_conflict="url",
            ignore_duplicates=True,
        )
        .execute()
    )
    return len(result.data or [])


def found_since(since: datetime, limit: int) -> list[CompetitorPainPointResponse]:
    """Complaints stored since ``since`` that an admin has not dismissed, newest first."""
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINTS)
        .select("*")
        .gte("found_at", since.isoformat())
        .neq("status", "dismissed")
        .order("found_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [CompetitorPainPointResponse.model_validate(row) for row in result.data or []]


def save_report(report: DailyReport) -> None:
    """Store the day's report; running it again the same day replaces it."""
    get_sb().table(COMPETITOR_PAIN_POINT_REPORTS).upsert(
        report.model_dump(mode="json"), on_conflict="report_date"
    ).execute()


def list_reports(*, offset: int, limit: int) -> tuple[list[DailyReportResponse], int]:
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINT_REPORTS)
        .select("*", count="exact")
        .order("report_date", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    rows = [DailyReportResponse.model_validate(row) for row in result.data or []]
    return rows, result.count or 0
