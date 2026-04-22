import json
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

SubmissionStatus = Literal[
    SUBMISSION_PENDING, SUBMISSION_APPROVED, SUBMISSION_REJECTED
]


class SubmissionCreate(BaseModel):
    """Incoming event submission.

    ``event_data`` is typed as ``EventCreate`` (audit S1) so the exact
    same validators used for real events — required ``title`` /
    ``location`` / ``organization``, length caps, allow-listed
    categories, safe URL schemes — apply to submissions.  This closes
    the mass-assignment hole where attackers could salt the payload
    with attacker-controlled ``created_by`` / ``id`` / ``added_at`` or
    XSS-ready strings that later reach the admin approval UI.

    The byte-size cap (``MAX_EVENT_DATA_BYTES``) is retained as a
    defense-in-depth belt-and-braces check — ``EventCreate``'s field
    caps already bound each string, but a maliciously large food list
    or description could still approach the 32 KB JSONB column limit.
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


class SubmissionResponse(BaseModel):
    id: str
    user_id: str
    # event_data in responses remains ``dict`` because historical rows in
    # the DB predate the typed schema and may not conform to
    # ``EventCreate`` validators on read (audit S22).  New rows are
    # written through ``SubmissionCreate`` so future reads are
    # structurally safe by construction.
    event_data: dict
    status: SubmissionStatus
    rejection_reason: str | None = None
    # Datetime fields parsed by Pydantic v2 (audit S9) so the OpenAPI
    # spec emits ``format: date-time`` and the frontend gets Date-aware
    # types.  Both ISO strings from PostgREST and native datetimes are
    # accepted transparently.
    submitted_at: datetime
    reviewed_at: datetime | None = None
