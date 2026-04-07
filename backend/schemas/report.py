from pydantic import BaseModel


class ReportCreate(BaseModel):
    event_id: int
    reason: str


class ReportUpdate(BaseModel):
    status: str  # "pending" | "resolved" | "dismissed"


class ReportResponse(BaseModel):
    id: str
    event_id: int
    user_id: str
    reason: str
    status: str
    reported_at: str
    resolved_at: str | None = None
