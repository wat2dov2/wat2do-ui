from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

MembershipStatus = Literal["pending", "approved", "rejected"]
MembershipRole = Literal["member", "officer", "owner"]


class UserMinResponse(BaseModel):
    id: UUID
    email: str
    full_name: str | None = None
    avatar_url: str | None = None


class OrganizationMembershipResponse(BaseModel):
    id: UUID
    organization_id: int
    user_id: UUID
    status: MembershipStatus
    role: MembershipRole
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrganizationMembershipWithUserResponse(BaseModel):
    id: UUID
    organization_id: int
    user_id: UUID
    status: MembershipStatus
    role: MembershipRole
    created_at: datetime
    updated_at: datetime
    user: UserMinResponse

    model_config = {"from_attributes": True}


class OrganizationMembershipUpdate(BaseModel):
    status: MembershipStatus
    role: MembershipRole | None = None
