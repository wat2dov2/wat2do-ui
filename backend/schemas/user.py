from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from core.constants import (
    MAX_AVATAR_URL_LENGTH,
    MAX_FACULTY_LENGTH,
    MAX_FULL_NAME_LENGTH,
    MAX_INTEREST_LENGTH,
    MAX_INTERESTS_COUNT,
    MAX_SCHOOL_LENGTH,
    ROLE_ADMIN,
    ROLE_USER,
)

UserRole = Literal[ROLE_USER, ROLE_ADMIN]

# Reusable constrained-string type for individual interest tags.
InterestStr = Annotated[str, Field(min_length=1, max_length=MAX_INTEREST_LENGTH)]


class UserBase(BaseModel):
    email: str
    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    avatar_url: str | None = Field(default=None, max_length=MAX_AVATAR_URL_LENGTH)


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    avatar_url: str | None = Field(default=None, max_length=MAX_AVATAR_URL_LENGTH)
    faculty: str | None = Field(default=None, max_length=MAX_FACULTY_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)
    interests: list[InterestStr] | None = Field(default=None, max_length=MAX_INTERESTS_COUNT)
    is_first_year: bool | None = None


class UserProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    faculty: str | None = Field(default=None, max_length=MAX_FACULTY_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)
    interests: list[InterestStr] | None = Field(default=None, max_length=MAX_INTERESTS_COUNT)
    is_first_year: bool | None = None


class UserRoleUpdate(BaseModel):
    """Admin-only payload for rotating a user's role.

    Separate from ``UserUpdate`` so ``role`` never leaks into a self-service
    update path - one shared model across trust boundaries would be a
    defense-in-depth gap.
    """

    model_config = ConfigDict(extra="forbid")

    role: UserRole


class UserResponse(UserBase):
    id: UUID
    faculty: str | None = None
    school: str | None = None
    interests: list[str] | None = None
    is_first_year: bool = False
    role: UserRole = ROLE_USER
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
