from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from core.constants import (
    MAX_AVATAR_URL_LENGTH,
    MAX_FULL_NAME_LENGTH,
    ROLE_ADMIN,
    ROLE_USER,
)

_SPREADSHEET_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def _validate_payout_email(value: EmailStr) -> EmailStr:
    if str(value).startswith(_SPREADSHEET_FORMULA_PREFIXES):
        raise ValueError("payout email cannot begin with a spreadsheet formula character")
    return value


# An email that cannot start a spreadsheet formula: payouts are exported as CSV.
PayoutEmail = Annotated[EmailStr, AfterValidator(_validate_payout_email)]

UserRole = Literal[ROLE_USER, ROLE_ADMIN]


class UserBase(BaseModel):
    email: str
    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    avatar_url: str | None = Field(default=None, max_length=MAX_AVATAR_URL_LENGTH)


class UserResponse(UserBase):
    id: UUID
    school_id: int | None = Field(default=None, exclude=True)
    faculty: str | None = None
    school: str | None = None
    interests: list[str] | None = None
    is_first_year: bool = False
    role: UserRole = ROLE_USER
    payout_email: PayoutEmail | None = None
    promoter_tos_accepted_at: datetime | None = None
    promoter_tos_version: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
