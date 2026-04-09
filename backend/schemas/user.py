from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from core.constants import (
    MAX_AVATAR_URL_LENGTH,
    MAX_FACULTY_LENGTH,
    MAX_FULL_NAME_LENGTH,
    MAX_INTEREST_LENGTH,
    MAX_INTERESTS_COUNT,
    MAX_SCHOOL_LENGTH,
    MAX_USERNAME_LENGTH,
    ROLE_ADMIN,
    ROLE_USER,
)

UserRole = Literal[ROLE_USER, ROLE_ADMIN]

# Reusable constrained-string type for individual interest tags.
InterestStr = Annotated[str, Field(min_length=1, max_length=MAX_INTEREST_LENGTH)]


class UserBase(BaseModel):
    email: str
    username: str | None = Field(default=None, max_length=MAX_USERNAME_LENGTH)
    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    avatar_url: str | None = Field(default=None, max_length=MAX_AVATAR_URL_LENGTH)


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, max_length=MAX_USERNAME_LENGTH)
    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    avatar_url: str | None = Field(default=None, max_length=MAX_AVATAR_URL_LENGTH)
    faculty: str | None = Field(default=None, max_length=MAX_FACULTY_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)
    interests: list[InterestStr] | None = Field(default=None, max_length=MAX_INTERESTS_COUNT)
    is_first_year: bool | None = None


class UserProfileUpdate(BaseModel):
    faculty: str | None = Field(default=None, max_length=MAX_FACULTY_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)
    interests: list[InterestStr] | None = Field(default=None, max_length=MAX_INTERESTS_COUNT)
    is_first_year: bool | None = None


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
