from pydantic import BaseModel


class SignupRequest(BaseModel):
    email: str
    password: str
    username: str | None = None
    full_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    access_token: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str


class SignupResponse(BaseModel):
    user_id: str
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    confirmation_required: bool = False


class MessageResponse(BaseModel):
    message: str
