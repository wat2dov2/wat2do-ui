from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

LeadStatus = Literal["new", "contacted", "replied", "submitted", "not_interested", "dismissed"]

_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_HTTPS = r"^https://\S+$"


class FoundOutreachLead(BaseModel):
    """One organizer as the research agent reported them, checked before it is stored."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    event_name: str = Field(min_length=1, max_length=200)
    event_url: str = Field(pattern=_HTTPS, max_length=2000)
    event_date: date | None = None
    organization: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(default="", max_length=120)
    contact_role: str = Field(default="", max_length=120)
    email: str = Field(pattern=_EMAIL, max_length=254)
    source_url: str = Field(pattern=_HTTPS, max_length=2000)
    context: str = Field(min_length=1, max_length=2000)
    video_script: str = Field(min_length=1, max_length=3000)
    email_subject: str = Field(min_length=1, max_length=150)
    email_body: str = Field(min_length=1, max_length=3000)
    follow_up: str = Field(min_length=1, max_length=2000)

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()


class OutreachLeadResponse(FoundOutreachLead):
    id: UUID
    lead_type: str
    school_slug: str
    school_name: str
    status: LeadStatus
    notes: str
    found_at: datetime


class OutreachLeadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: LeadStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)
