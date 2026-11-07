"""Store what the sweep finds; Rust serves it to the admin page."""

from __future__ import annotations

from datetime import datetime

from core.database import get_sb
from core.tables import (
    COMPETITOR_PAIN_POINT_FEATURES,
    COMPETITOR_PAIN_POINT_REPORTS,
    COMPETITOR_PAIN_POINTS,
)
from schemas.competitor_pain_point import (
    CompetitorPainPointResponse,
    DailyReport,
    FoundPainPoint,
    PainPointFeature,
)


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


def recent_reports(limit: int) -> list[DailyReport]:
    """The latest daily reports, newest first."""
    result = (
        get_sb()
        .table(COMPETITOR_PAIN_POINT_REPORTS)
        .select("*")
        .order("report_date", desc=True)
        .limit(limit)
        .execute()
    )
    return [DailyReport.model_validate(row) for row in result.data or []]


def all_features() -> list[PainPointFeature]:
    """The whole feature backlog."""
    result = get_sb().table(COMPETITOR_PAIN_POINT_FEATURES).select("*").execute()
    return [PainPointFeature.model_validate(row) for row in result.data or []]


def save_features(features: list[PainPointFeature]) -> None:
    """Add new features and rewrite changed ones, matched by key."""
    if not features:
        return
    now = datetime.now().astimezone().isoformat()
    get_sb().table(COMPETITOR_PAIN_POINT_FEATURES).upsert(
        [{**feature.model_dump(mode="json"), "updated_at": now} for feature in features],
        on_conflict="key",
    ).execute()
