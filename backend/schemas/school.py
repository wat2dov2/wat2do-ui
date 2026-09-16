from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def validate_recipient_id(value: Any) -> str:
    """Return one canonical numeric Instagram notification recipient ID."""
    if (
        not isinstance(value, str)
        or not value.isascii()
        or not value.isdigit()
        or not 1 <= len(value) <= 32
        or value.startswith("0")
    ):
        raise ValueError("recipient_id must be a canonical numeric identifier")
    return value


class School(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
    primary_color: str
    secondary_color: str
    timezone: str
    language: Literal["en", "fr"] = "en"
    faculties: list[str] = Field(default_factory=list)
    location_examples: list[str] = Field(default_factory=list)
    recipient_id: str | None = None
    semester_start: date | None = None
    semester_end: date | None = None
    social_preview_image_url: str | None = None

    @field_validator("recipient_id")
    @classmethod
    def validate_notification_recipient_id(cls, value: str | None) -> str | None:
        return None if value is None else validate_recipient_id(value)


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
    timezone: str
    language: Literal["en", "fr"] = "en"
    faculties: list[str] = Field(default_factory=list)
    location_examples: list[str] = Field(default_factory=list)
    email_domains: list[str] = Field(default_factory=list)
