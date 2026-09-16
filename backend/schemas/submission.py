from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import (
    MAX_EVENT_DATA_BYTES,
    MAX_REJECTION_REASON_LENGTH,
    SUBMISSION_APPROVED,
    SUBMISSION_PENDING,
    SUBMISSION_REJECTED,
)
from schemas.event import EventCreate
from schemas.position import PositionCreate

SubmissionStatus = Literal[SUBMISSION_PENDING, SUBMISSION_APPROVED, SUBMISSION_REJECTED]


class SubmissionCreate(BaseModel):
    """Normal-user event submission for admin review.

    ``event_data`` uses the same schema as direct event creation so
    moderation receives a payload that can be published without a second
    shape translation step.
    """

    model_config = ConfigDict(extra="forbid")

    event_data: EventCreate

    @field_validator("event_data")
    @classmethod
    def _event_data_size_limit(cls, v: EventCreate) -> EventCreate:
        size = len(v.model_dump_json())
        if size > MAX_EVENT_DATA_BYTES:
            raise ValueError(
                f"event_data exceeds maximum size ({size} bytes, limit {MAX_EVENT_DATA_BYTES})"
            )
        return v


class SubmissionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: SubmissionStatus
    rejection_reason: str | None = Field(default=None, max_length=MAX_REJECTION_REASON_LENGTH)


class SubmissionMetadata(BaseModel):
    school: str | None = None
    id: str
    user_id: str | None
    status: SubmissionStatus
    rejection_reason: str | None = None
    submitted_at: datetime
    reviewed_at: datetime | None = None
    submitted_by_email: str | None = None


class SubmissionResponse(SubmissionMetadata):
    event_data: dict
    club_name: str | None = None


class PositionSubmissionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position_data: PositionCreate


class PositionSubmissionResponse(SubmissionMetadata):
    position_data: PositionCreate
