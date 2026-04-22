from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import (
    MAX_REPORT_REASON_LENGTH,
    REPORT_DISMISSED,
    REPORT_PENDING,
    REPORT_RESOLVED,
)

ReportStatus = Literal[REPORT_PENDING, REPORT_RESOLVED, REPORT_DISMISSED]


# Free-text fields are rendered in the admin UI.  Pydantic is not a
# sanitiser, but a schema-layer reject on obvious HTML / script-scheme
# payloads (audit S18) provides defense in depth against stored XSS when
# the React renderer path is bypassed or changed in the future.
_FORBIDDEN_REASON_SUBSTRINGS = ("<", ">", "javascript:", "data:")


def _reject_html_in_free_text(v: str) -> str:
    lowered = v.lower()
    for bad in _FORBIDDEN_REASON_SUBSTRINGS:
        if bad in lowered:
            raise ValueError(
                "free-text field may not contain HTML tags or dangerous URL schemes"
            )
    return v


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: int
    reason: str = Field(..., min_length=1, max_length=MAX_REPORT_REASON_LENGTH)

    @field_validator("reason")
    @classmethod
    def _reason_no_html(cls, v: str) -> str:
        return _reject_html_in_free_text(v)


class ReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ReportStatus


class ReportResponse(BaseModel):
    id: str
    event_id: int
    user_id: str
    reason: str
    status: ReportStatus
    # Datetimes parsed via Pydantic v2 (audit S9) so OpenAPI emits
    # ``format: date-time``; ISO strings from PostgREST are coerced
    # transparently.
    reported_at: datetime
    resolved_at: datetime | None = None
