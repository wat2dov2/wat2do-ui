from typing import Literal

from pydantic import BaseModel, Field

from constants import REPORT_DISMISSED, REPORT_PENDING, REPORT_RESOLVED
from core.constants import MAX_REPORT_REASON_LENGTH

ReportStatus = Literal[REPORT_PENDING, REPORT_RESOLVED, REPORT_DISMISSED]


class ReportCreate(BaseModel):
    event_id: int
    reason: str = Field(..., min_length=1, max_length=MAX_REPORT_REASON_LENGTH)


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
