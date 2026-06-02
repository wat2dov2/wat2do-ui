from pydantic import BaseModel, EmailStr, Field

from core.constants import MAX_FULL_NAME_LENGTH, MAX_SCHOOL_LENGTH, MAX_USERNAME_LENGTH

# A6/A7: Password constraints protect the backend even when the frontend
# validation is bypassed (e.g. direct API calls).  Supabase enforces its own
# minimum (currently 6) but that setting can drift — enforce here for defence
# in depth.  EmailStr additionally rejects header-injection / CRLF payloads
# (see E7 in the error audit).
_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_LENGTH = 128


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)
    # S6: cap ``username`` / ``full_name`` at the same limits enforced
    # elsewhere so a >1 MB string cannot reach Supabase / DB.
    username: str | None = Field(default=None, max_length=MAX_USERNAME_LENGTH)
    full_name: str | None = Field(default=None, max_length=MAX_FULL_NAME_LENGTH)
    token: str | None = Field(default=None, description="Optional invitation token")



class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    access_token: str = Field(..., min_length=1, max_length=4096)
    refresh_token: str = Field(..., min_length=1, max_length=4096)
    new_password: str = Field(..., min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)


class SignupResponse(BaseModel):
    user_id: str
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    confirmation_required: bool = False
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)


class MessageResponse(BaseModel):
    message: str
