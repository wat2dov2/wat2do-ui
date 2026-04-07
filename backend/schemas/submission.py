from pydantic import BaseModel


class SubmissionCreate(BaseModel):
    event_data: dict


class SubmissionUpdate(BaseModel):
    status: str  # "pending" | "approved" | "rejected"
    rejection_reason: str | None = None


class SubmissionResponse(BaseModel):
    id: str
    user_id: str
    event_data: dict
    status: str
    rejection_reason: str | None = None
    submitted_at: str
    reviewed_at: str | None = None
