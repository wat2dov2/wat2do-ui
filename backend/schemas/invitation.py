from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ClubInvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(..., min_length=3, description="Email to invite")


class ClubInvitationResponse(BaseModel):
    id: UUID
    club_id: int
    email: str
    token: UUID
    invited_by: UUID
    status: str
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


class ClubInvitationPublicResponse(BaseModel):
    club_name: str
    email: str
    expires_at: datetime

    model_config = {"from_attributes": True}
