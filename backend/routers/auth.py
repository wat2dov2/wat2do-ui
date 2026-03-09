from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import bearer
from core.database import get_db
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
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    return await auth_service.signup(db, data)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    return await auth_service.login(data)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest):
    return await auth_service.refresh(data)


@router.post("/logout", response_model=MessageResponse)
async def logout(token=Depends(bearer)):
    await auth_service.logout(token.credentials)
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(data: ForgotPasswordRequest):
    await auth_service.forgot_password(data.email)
    return MessageResponse(message="If that email exists, a reset link has been sent")


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(data: ResetPasswordRequest):
    await auth_service.reset_password(data)
    return MessageResponse(message="Password updated successfully")
