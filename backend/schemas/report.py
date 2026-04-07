from typing import Literal

from pydantic import BaseModel

ReportStatus = Literal["pending", "resolved", "dismissed"]


class ReportCreate(BaseModel):
    event_id: int
    reason: str


class ReportUpdate(BaseModel):
    status: ReportStatus


class ReportResponse(BaseModel):
    id: str
    event_id: int
    user_id: str
    reason: str
    status: ReportStatus
    reported_at: str
    resolved_at: str | None = None
