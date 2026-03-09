from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from supabase_auth.errors import AuthApiError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import supabase
from core.logging import logger
from models.user import User
from schemas.auth import (
    SignupRequest,
    SignupResponse,
    LoginRequest,
    RefreshRequest,
    ResetPasswordRequest,
    TokenResponse,
)

async def signup(db: AsyncSession, data: SignupRequest) -> SignupResponse:
    try:
        res = supabase.auth.sign_up({"email": data.email, "password": data.password})
    except AuthApiError as e:
        logger.warning("Signup failed for %s: %s", data.email, e.message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)

    if not res.user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signup failed — check email/password requirements",
        )

    user = User(
        supabase_auth_id=res.user.id,
        email=data.email,
        username=data.username,
        full_name=data.full_name,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already taken",
        )
    await db.refresh(user)
    logger.info("Created DB user %s for supabase uid %s", user.id, res.user.id)

    if res.session:
        return SignupResponse(
            user_id=str(user.id),
            access_token=res.session.access_token,
            refresh_token=res.session.refresh_token,
            expires_in=res.session.expires_in,
        )

    return SignupResponse(
        user_id=str(user.id),
        confirmation_required=True,
    )


async def login(data: LoginRequest) -> TokenResponse:
    try:
        res = supabase.auth.sign_in_with_password(
            {"email": data.email, "password": data.password}
        )
    except AuthApiError as e:
        logger.warning("Login failed for %s: %s", data.email, e.message)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message)

    if not res.session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    return TokenResponse(
        access_token=res.session.access_token,
        refresh_token=res.session.refresh_token,
        expires_in=res.session.expires_in,
        user_id=res.user.id,
    )


async def refresh(data: RefreshRequest) -> TokenResponse:
    try:
        res = supabase.auth.refresh_session(data.refresh_token)
    except AuthApiError as e:
        logger.warning("Token refresh failed: %s", e.message)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message)

    if not res.session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not refresh session — please log in again",
        )

    return TokenResponse(
        access_token=res.session.access_token,
        refresh_token=res.session.refresh_token,
        expires_in=res.session.expires_in,
        user_id=res.user.id,
    )


async def logout(access_token: str) -> None:
    try:
        supabase.auth.sign_out(access_token)
    except AuthApiError as e:
        logger.warning("Logout error: %s", e.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
        )


async def forgot_password(email: str) -> None:
    try:
        supabase.auth.reset_password_email(email)
    except AuthApiError as e:
        logger.warning("Password reset request failed for %s: %s", email, e.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
        )


async def reset_password(data: ResetPasswordRequest) -> None:
    try:
        supabase.auth.update_user(
            {"password": data.new_password},
            access_token=data.access_token,
        )
    except AuthApiError as e:
        logger.warning("Password reset failed: %s", e.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
        )
