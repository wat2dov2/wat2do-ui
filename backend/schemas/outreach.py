import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

CampaignStatus = Literal["active", "paused", "done"]
LeadStatus = Literal["new", "contacted", "replied", "submitted", "not_interested", "dismissed"]

_SLUG = r"^[a-z0-9_]+$"
_SCHOOL_SLUG = r"^[a-z0-9-]{1,80}$"
_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_HTTPS = r"^https://\S+$"


class OutreachCampaignCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    lead_type: str = Field(pattern=_SLUG, max_length=64)
    goal: str = Field(default="", max_length=1000)
    # Empty means every school.
    school_slugs: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("school_slugs")
    @classmethod
    def _slugs(cls, value: list[str]) -> list[str]:
        for slug in value:
            if not re.fullmatch(_SCHOOL_SLUG, slug):
                raise ValueError("School slugs are lowercase letters, digits and dashes")
        return sorted(set(value))


class OutreachCampaignUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = Field(default=None, max_length=1000)
    status: CampaignStatus | None = None


class OutreachCampaignResponse(BaseModel):
    id: UUID
    name: str
    lead_type: str
    goal: str
    school_slugs: list[str]
    status: CampaignStatus
    created_at: datetime


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
    campaign_id: UUID
    school_slug: str
    school_name: str
    status: LeadStatus
    notes: str
    found_at: datetime


class OutreachLeadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: LeadStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)
