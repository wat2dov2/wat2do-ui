from typing import Literal

from pydantic import BaseModel

SubmissionStatus = Literal["pending", "approved", "rejected"]


class SubmissionCreate(BaseModel):
    event_data: dict


class SubmissionUpdate(BaseModel):
    status: SubmissionStatus
    rejection_reason: str | None = None


class SubmissionResponse(BaseModel):
    id: str
    user_id: str
    event_data: dict
    status: SubmissionStatus
    rejection_reason: str | None = None
    submitted_at: str
    reviewed_at: str | None = None
