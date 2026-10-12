"""How long events take to reach wat2do after their Instagram post goes up."""

from datetime import datetime

from pydantic import BaseModel


class LatencyStats(BaseModel):
    count: int
    mean_minutes: float | None
    median_minutes: float | None


class SchoolIngestionLatency(LatencyStats):
    school: str


class HourlyIngestionLatency(BaseModel):
    hour: datetime
    count: int
    mean_minutes: float
    median_minutes: float


class IngestionLatencyResponse(BaseModel):
    since: datetime
    overall: LatencyStats
    schools: list[SchoolIngestionLatency]
    hourly: list[HourlyIngestionLatency]
