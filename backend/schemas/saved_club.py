from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SavedClubResponse(BaseModel):
    id: str
    user_id: str
    club_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}


class SaveClubStatusResponse(BaseModel):
    """Response for ``PUT /saved-clubs/{id}`` / ``DELETE /saved-clubs/{id}``.

    Typed explicitly so the response contract is locked at the
    OpenAPI boundary.
    """

    status: Literal["saved", "unsaved"]
