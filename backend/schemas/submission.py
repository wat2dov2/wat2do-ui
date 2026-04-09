import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from constants import SUBMISSION_APPROVED, SUBMISSION_PENDING, SUBMISSION_REJECTED
from core.constants import MAX_EVENT_DATA_BYTES, MAX_REJECTION_REASON_LENGTH

SubmissionStatus = Literal[
    SUBMISSION_PENDING, SUBMISSION_APPROVED, SUBMISSION_REJECTED
]


class SubmissionCreate(BaseModel):
    event_data: dict

    @field_validator("event_data")
    @classmethod
    def _event_data_size_limit(cls, v: dict) -> dict:
        size = len(json.dumps(v, separators=(",", ":")))
        if size > MAX_EVENT_DATA_BYTES:
            raise ValueError(
                f"event_data exceeds maximum size ({size} bytes, limit {MAX_EVENT_DATA_BYTES})"
            )
        return v


class SubmissionUpdate(BaseModel):
    status: SubmissionStatus
    rejection_reason: str | None = Field(default=None, max_length=MAX_REJECTION_REASON_LENGTH)


class SubmissionResponse(BaseModel):
    id: str
    user_id: str
    event_data: dict
    status: SubmissionStatus
    rejection_reason: str | None = None
    submitted_at: str
    reviewed_at: str | None = None
