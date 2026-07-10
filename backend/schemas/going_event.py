from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class GoingEventResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    going_at: datetime

    model_config = {"from_attributes": True}


class UserEventPair(BaseModel):
    """Minimal (user_id, event_id) pair used by collaborative filtering."""

    user_id: str
    event_id: int


class GoingEventStatusResponse(BaseModel):
    """Locks the going/not_going status contract at the OpenAPI boundary."""

    status: Literal["going", "not_going"]
    going_count: int
