from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from schemas.user import UserResponse


class ClubJoinRequestCreate(BaseModel):
    pitch: str = Field(..., min_length=10, max_length=1000)


class ClubJoinRequestResponse(BaseModel):
    id: UUID
    club_id: int
    user_id: UUID
    pitch: str
    status: str
    created_at: datetime
    updated_at: datetime
    users: UserResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class ClubJoinRequestUpdate(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
