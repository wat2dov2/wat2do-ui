from datetime import datetime

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
