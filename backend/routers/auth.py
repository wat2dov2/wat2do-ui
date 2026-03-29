from fastapi import APIRouter, Depends

from core.auth import bearer
from schemas.auth import (
    SignupRequest,
    SignupResponse,
    LoginRequest,
    RefreshRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    TokenResponse,
    MessageResponse,
)
from services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=SignupResponse)
def signup(data: SignupRequest):
    return auth_service.signup(data)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest):
    return auth_service.login(data)


@router.post("/refresh", response_model=TokenResponse)
def refresh(data: RefreshRequest):
    return auth_service.refresh(data)


@router.post("/logout", response_model=MessageResponse)
def logout(_=Depends(bearer)):
    auth_service.logout()
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(data: ForgotPasswordRequest):
    auth_service.forgot_password(data.email)
    return MessageResponse(message="If that email exists, a reset link has been sent")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(data: ResetPasswordRequest):
    auth_service.reset_password(data)
    return MessageResponse(message="Password updated successfully")
