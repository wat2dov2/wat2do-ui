from datetime import datetime

from pydantic import BaseModel


class SavedEventResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}
