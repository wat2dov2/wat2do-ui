from datetime import datetime
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
