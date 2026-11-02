from datetime import datetime

from pydantic import BaseModel


class SavedClubResponse(BaseModel):
    id: str
    user_id: str
    club_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}
