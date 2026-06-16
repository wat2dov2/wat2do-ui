from pydantic import BaseModel, EmailStr, Field

from core.constants import MAX_SCHOOL_LENGTH

# A6/A7: Password constraints protect the backend even when the frontend
# validation is bypassed (e.g. direct API calls).  Supabase enforces its own
# minimum (currently 6) but that setting can drift — enforce here for defence
# in depth.  EmailStr additionally rejects header-injection / CRLF payloads
# (see E7 in the error audit).
_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_LENGTH = 128


class SendOtpRequest(BaseModel):
    email: EmailStr
    token: str | None = Field(default=None, description="Optional invitation token")


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    token: str = Field(..., min_length=1, max_length=255)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)
    onboarding_required: bool = False


class SignupResponse(BaseModel):
    user_id: str
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    confirmation_required: bool = False
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)


class MessageResponse(BaseModel):
    message: str
