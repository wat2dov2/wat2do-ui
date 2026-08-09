from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class School(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
    primary_color: str
    secondary_color: str
    timezone: str
    recipient_id: str | None = None
    semester_start: date | None = None
    semester_end: date | None = None
    social_preview_image_url: str | None = None


class SchoolRecord(School):
    id: int
    social_preview_revision: int = 0
    social_preview_rendered_revision: int = 0
    social_preview_rendered_at: datetime | None = None


class SchoolSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
    primary_color: str
    secondary_color: str
    email_domains: list[str] = Field(default_factory=list)
