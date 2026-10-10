"""Summarise delays between an Instagram post and the agent catching it."""

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
    """Mean and median catch delay per school and per hour over the last ``days``."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = get_sb().rpc("ingestion_latencies", {"p_since": since.isoformat()}).execute().data or []
    by_kind: defaultdict[str, list[float]] = defaultdict(list)
    by_school: defaultdict[tuple[str, str], list[float]] = defaultdict(list)
    by_hour: defaultdict[datetime, list[float]] = defaultdict(list)
    for row in rows:
        minutes = float(row["latency_seconds"]) / 60
        caught_at = parse_iso_datetime(row["caught_at"])
        by_kind[row["kind"]].append(minutes)
        by_school[(row["school"], row["kind"])].append(minutes)
        if caught_at is not None:
            by_hour[caught_at.replace(minute=0, second=0, microsecond=0)].append(minutes)
    schools = sorted({school for school, _ in by_school})
    return IngestionLatencyResponse(
        since=since,
        new_events=_stats(by_kind["new"]),
        updates=_stats(by_kind["update"]),
        schools=[
            SchoolIngestionLatency(
                school=school,
                new_events=_stats(by_school[(school, "new")]),
                updates=_stats(by_school[(school, "update")]),
            )
            for school in schools
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
