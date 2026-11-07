from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PainPointAudience = Literal["organizer", "attendee", "other"]
PainPointStatus = Literal["new", "seen", "dismissed"]
FeatureAudience = Literal["organizer", "attendee", "both"]
FeatureStatus = Literal["open", "built"]
FEATURE_KEY_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"


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


class FeatureUpdate(BaseModel):
    """A feature in the backlog as one report adds or rewrites it.

    The five scores run from 1 to 5: demand (how many people ask), pain (how
    much it hurts them), fit (how well it suits wat2do), edge (how much it sets
    wat2do apart) and ease (how little work it is).
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    key: str = Field(pattern=FEATURE_KEY_PATTERN, max_length=80)
    title: str = Field(min_length=1, max_length=300)
    problem: str = Field(min_length=1, max_length=2000)
    change: str = Field(min_length=1, max_length=4000)
    where: list[str] = Field(default_factory=list, max_length=20)
    audience: FeatureAudience
    status: FeatureStatus
    demand: int = Field(ge=1, le=5)
    pain: int = Field(ge=1, le=5)
    fit: int = Field(ge=1, le=5)
    edge: int = Field(ge=1, le=5)
    ease: int = Field(ge=1, le=5)
    rationale: str = Field(default="", max_length=2000)
    competitors: list[str] = Field(default_factory=list, max_length=30)
    complaint_urls: list[str] = Field(default_factory=list, max_length=200)


class PainPointFeature(FeatureUpdate):
    """A feature as the backlog stores it: every complaint behind it so far."""

    report_count: int = Field(ge=1)
    first_seen: date
    last_seen: date
