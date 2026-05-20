from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SavedEventResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}


class UserEventPair(BaseModel):
    """Minimal (user_id, event_id) pair used by collaborative filtering."""

    user_id: str
    event_id: int


class SaveEventStatusResponse(BaseModel):
    """Response for ``PUT /saved-events/{id}`` / ``DELETE /saved-events/{id}``.

    Typed explicitly (audit S7) so the response contract is locked at the
    OpenAPI boundary — future refactors that add fields to the dict will
    be caught by the frontend type generator.
    """

    status: Literal["saved", "unsaved"]
