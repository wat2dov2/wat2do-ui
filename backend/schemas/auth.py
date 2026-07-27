from unicodedata import category
from urllib.parse import unquote, urlsplit

from pydantic import BaseModel, EmailStr, Field, field_validator

from core.constants import MAX_SCHOOL_LENGTH, MAX_URL_LENGTH

# Password constraints protect the backend even when the frontend
# validation is bypassed (e.g. direct API calls).  Supabase enforces its own
# minimum (currently 6) but that setting can drift - enforce here for defence
# in depth.  EmailStr additionally rejects header-injection / CRLF payloads.
_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_LENGTH = 128


class SendOtpRequest(BaseModel):
    email: EmailStr
    token: str | None = Field(default=None, description="Optional invitation token")
    return_to: str | None = Field(default=None, max_length=MAX_URL_LENGTH)

    @field_validator("return_to")
    @classmethod
    def validate_return_to(cls, value: str | None) -> str | None:
        if value is None:
            return None
        decoded = value
        while True:
            next_value = unquote(decoded)
            if next_value == decoded:
                break
            decoded = next_value
        parsed = urlsplit(decoded)
        if (
            not decoded.startswith("/")
            or decoded.startswith("//")
            or parsed.scheme
            or parsed.netloc
            or "\\" in decoded
            or any(category(character) == "Cc" for character in decoded)
        ):
            raise ValueError("return_to must be a safe relative application path")
        return decoded


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
