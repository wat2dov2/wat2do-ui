from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SavedOrganizationResponse(BaseModel):
    id: str
    user_id: str
    organization_id: int
    saved_at: datetime

    model_config = {"from_attributes": True}


class SaveOrganizationStatusResponse(BaseModel):
    """Locks the save/unsave status contract at the OpenAPI boundary."""

    status: Literal["saved", "unsaved"]
