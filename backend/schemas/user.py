from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class UserBase(BaseModel):
    email: str
    username: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None


class UserUpdate(BaseModel):
    username: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None


class UserResponse(UserBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
