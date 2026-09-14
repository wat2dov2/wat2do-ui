from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GoingEventResponse(BaseModel):
    id: UUID
    user_id: UUID
    event_id: int
    event_date_id: UUID
    going_at: datetime

    model_config = {"from_attributes": True}


class UserEventPair(BaseModel):
    """Minimal (user_id, event_id) pair used by collaborative filtering."""

    user_id: UUID
    event_id: int


class GoingEventSelection(BaseModel):
    event_id: int
    occurrence_ids: list[UUID]


class GoingEventSelectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurrence_ids: list[UUID] = Field(min_length=1)


class GoingEventStatusResponse(BaseModel):
    """Locks the going/not_going status contract at the OpenAPI boundary."""

    status: Literal["going", "not_going"]
    event_id: int
    occurrence_ids: list[UUID]
    going_count: int


class EventAttendeeResponse(BaseModel):
    name: str
    avatar_url: str


class EventAttendeesResponse(BaseModel):
    """Public who's-going summary without user IDs or full names."""

    going_count: int
    attendees: list[EventAttendeeResponse]
