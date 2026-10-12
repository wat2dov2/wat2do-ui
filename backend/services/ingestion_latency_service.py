"""Summarise delays between an Instagram post and its event being added to wat2do."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from statistics import fmean, median

from core.database import get_sb
from core.sanitize import parse_iso_datetime
from schemas.ingestion_latency import (
    HourlyIngestionLatency,
    IngestionLatencyResponse,
    LatencyStats,
    SchoolIngestionLatency,
)


def get_report(days: int) -> IngestionLatencyResponse:
    """Mean and median delay overall, per school and per hour over the last ``days``."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = get_sb().rpc("ingestion_latencies", {"p_since": since.isoformat()}).execute().data or []
    overall: list[float] = []
    by_school: defaultdict[str, list[float]] = defaultdict(list)
    by_hour: defaultdict[datetime, list[float]] = defaultdict(list)
    for row in rows:
        minutes = float(row["latency_seconds"]) / 60
        added_at = parse_iso_datetime(row["added_at"])
        overall.append(minutes)
        by_school[row["school"]].append(minutes)
        if added_at is not None:
            by_hour[added_at.replace(minute=0, second=0, microsecond=0)].append(minutes)
    return IngestionLatencyResponse(
        since=since,
        overall=_stats(overall),
        schools=[
            SchoolIngestionLatency(school=school, **_stats(values).model_dump())
            for school, values in sorted(by_school.items())
        ],
        hourly=[
            HourlyIngestionLatency(
                hour=hour,
                count=len(values),
                mean_minutes=fmean(values),
                median_minutes=median(values),
            )
            for hour, values in sorted(by_hour.items())
        ],
    )


def _stats(values: list[float]) -> LatencyStats:
    return LatencyStats(
        count=len(values),
        mean_minutes=fmean(values) if values else None,
        median_minutes=median(values) if values else None,
    )
