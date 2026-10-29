from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

LeadStatus = Literal["new", "contacted", "replied", "claimed", "not_interested", "dismissed"]
EmailFoundBy = Literal["club_page", "research"]

_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_HTTPS = r"^https://\S+$"


class FoundClubEmail(BaseModel):
    """A club's email and the public page it is printed on, checked before it is stored."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    email: str = Field(pattern=_EMAIL, max_length=254)
    source_url: str = Field(pattern=_HTTPS, max_length=2000)

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()


class OutreachLeadResponse(BaseModel):
    """One unclaimed club, its email, and what to send it to claim its page."""

    id: UUID
    club_id: int
    club_name: str
    club_url: str
    listings: int
    school_slug: str
    school_name: str
    email: str
    email_source_url: str
    email_found_by: EmailFoundBy
    email_subject: str
    email_body: str
    follow_up: str
    status: LeadStatus
    notes: str
    found_at: datetime


class OutreachLeadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: LeadStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)
