from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class EventRsvpResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    rsvped_at: datetime

    model_config = {"from_attributes": True}


class RsvpEventStatusResponse(BaseModel):
    """Response for ``PUT /event-rsvps/{id}`` / ``DELETE /event-rsvps/{id}``."""

    status: Literal["going", "not_going"]
