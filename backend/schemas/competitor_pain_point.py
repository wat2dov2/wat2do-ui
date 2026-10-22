from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PainPointAudience = Literal["organizer", "attendee", "other"]
PainPointStatus = Literal["new", "seen", "dismissed"]


class FoundPainPoint(BaseModel):
    """One complaint as the sweep agent reported it, checked before it is stored."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    competitor: str = Field(pattern=r"^[a-z0-9_]+$")
    source: str = Field(pattern=r"^[a-z0-9_]+$")
    url: str = Field(pattern=r"^https://\S+$", max_length=2000)
    author: str = Field(default="", max_length=200)
    quote: str = Field(min_length=1, max_length=2000)
    pain_point: str = Field(min_length=1, max_length=300)
    audience: PainPointAudience
    posted_at: datetime | None = None


class CompetitorPainPointResponse(FoundPainPoint):
    id: UUID
    found_at: datetime
    status: PainPointStatus


class CompetitorPainPointReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: PainPointStatus


SuggestionPriority = Literal["high", "medium", "low"]


class ReportTheme(BaseModel):
    """A complaint that keeps coming up in one day's findings."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    theme: str = Field(min_length=1, max_length=300)
    detail: str = Field(min_length=1, max_length=2000)
    competitors: list[str] = Field(default_factory=list, max_length=30)
    complaint_urls: list[str] = Field(default_factory=list, max_length=30)


class ReportSuggestion(BaseModel):
    """One change to wat2do.io the report suggests, and the complaints behind it."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=300)
    priority: SuggestionPriority
    problem: str = Field(min_length=1, max_length=2000)
    change: str = Field(min_length=1, max_length=4000)
    where: list[str] = Field(default_factory=list, max_length=20)
    complaint_urls: list[str] = Field(default_factory=list, max_length=30)


class DailyReport(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    report_date: date
    model: str
    complaint_count: int = Field(ge=0)
    summary: str = Field(min_length=1, max_length=4000)
    themes: list[ReportTheme] = Field(default_factory=list, max_length=20)
    suggestions: list[ReportSuggestion] = Field(default_factory=list, max_length=20)


class DailyReportResponse(DailyReport):
    id: UUID
    created_at: datetime
