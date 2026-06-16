from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrganizationInvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(..., min_length=3, description="Email to invite")


class OrganizationInvitationResponse(BaseModel):
    id: UUID
    organization_id: int
    email: str
    token: UUID
    invited_by: UUID
    status: str
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


class OrganizationInvitationPublicResponse(BaseModel):
    organization_name: str
    email: str
    expires_at: datetime

    model_config = {"from_attributes": True}
