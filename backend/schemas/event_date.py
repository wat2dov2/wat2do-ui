"""Pydantic models for the event_dates table.

One row represents a single occurrence of an event. An event with N
occurrences (e.g. a recurring weekly meeting) is one events row +
N event_dates rows.
"""

from datetime import datetime, timezone
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

# Free-form short strings - the extractor sometimes returns "1 hour"
# or "01:30:00", and we don't want to force a single format here.
_MAX_DURATION_LENGTH = 64
# IANA timezone identifiers like "America/New_York" - generous cap.
_MAX_TZ_LENGTH = 64


class OccurrenceCreate(BaseModel):
    """One occurrence: start time plus optional end / duration / timezone."""

    model_config = ConfigDict(extra="forbid")

    dtstart_utc: AwareDatetime
    dtend_utc: AwareDatetime | None = None
    duration: str | None = Field(default=None, max_length=_MAX_DURATION_LENGTH)
    tz: str | None = Field(default=None, max_length=_MAX_TZ_LENGTH)

    @field_validator("dtstart_utc", "dtend_utc")
    @classmethod
    def _normalize_utc(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _dtend_after_dtstart(self):
        if self.dtend_utc is not None and self.dtend_utc <= self.dtstart_utc:
            raise ValueError("dtend_utc must be after dtstart_utc")
        return self


class OccurrenceResponse(BaseModel):
    id: UUID | int
    event_id: int
    dtstart_utc: datetime
    dtend_utc: datetime | None = None
    duration: str | None = None
    tz: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
