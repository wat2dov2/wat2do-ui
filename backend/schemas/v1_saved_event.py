from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class V1SavedEventResponse(BaseModel):
    id: UUID
    user_id: UUID
    event_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}


class V1SavedEventStatusResponse(BaseModel):
    status: Literal["saved", "unsaved"]
