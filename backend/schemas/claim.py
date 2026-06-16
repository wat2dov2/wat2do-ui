from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from schemas.organization import OrganizationResponse
from schemas.user import UserResponse


class OrganizationClaimCreate(BaseModel):
    executive_role: str = Field(..., min_length=2, max_length=100)
    proof_url: str | None = Field(default=None, max_length=500)


class OrganizationClaimResponse(BaseModel):
    id: UUID
    organization_id: int
    user_id: UUID
    executive_role: str
    proof_url: str | None
    status: str
    rejection_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    organizations: OrganizationResponse | None = None
    users: UserResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class OrganizationClaimUpdate(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    rejection_reason: str | None = Field(default=None, max_length=500)
