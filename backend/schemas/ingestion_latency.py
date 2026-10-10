"""How long the ingestion agent takes to catch Instagram posts."""

from datetime import datetime

from pydantic import BaseModel


class LatencyStats(BaseModel):
    count: int
    mean_minutes: float | None
    median_minutes: float | None


class SchoolIngestionLatency(BaseModel):
    school: str
    new_events: LatencyStats
    updates: LatencyStats


class HourlyIngestionLatency(BaseModel):
    hour: datetime
    count: int
    mean_minutes: float
    median_minutes: float


class IngestionLatencyResponse(BaseModel):
    since: datetime
    new_events: LatencyStats
    updates: LatencyStats
    schools: list[SchoolIngestionLatency]
    hourly: list[HourlyIngestionLatency]
