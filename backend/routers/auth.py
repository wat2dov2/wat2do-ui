from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from core.auth import bearer
from core.config import settings
from core.errors import NO_REFRESH_TOKEN
from core.rate_limit import (
    auth_rate_limiter,
    auth_refresh_rate_limiter,
    auth_sensitive_rate_limiter,
)
from schemas.auth import (
    SignupRequest,
    SignupResponse,
    LoginRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    TokenResponse,
    MessageResponse,
)
from services.auth_service import auth

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set the refresh token as an httpOnly cookie."""
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/auth",
        max_age=COOKIE_MAX_AGE,
        domain=settings.cookie_domain or None,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Clear the refresh token cookie."""
    response.delete_cookie(
        key="refresh_token",
        path="/auth",
        domain=settings.cookie_domain or None,
    )


@router.post("/signup", response_model=SignupResponse)
def signup(
    data: SignupRequest,
    response: Response,
    _rl: None = Depends(auth_rate_limiter.ip_dependency()),
):
    result = auth.signup(data)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token)
    return result.body


@router.post("/login", response_model=TokenResponse)
def login(
    data: LoginRequest,
    response: Response,
    _rl: None = Depends(auth_rate_limiter.ip_dependency()),
):
    result = auth.login(data)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token)
    return result.body


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    _rl: None = Depends(auth_refresh_rate_limiter.ip_dependency()),
):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=NO_REFRESH_TOKEN,
        )
    result = auth.refresh(refresh_token)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token)
    return result.body


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response, token=Depends(bearer)):
    auth.logout(token.credentials)
    _clear_refresh_cookie(response)
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    data: ForgotPasswordRequest,
    _rl: None = Depends(auth_sensitive_rate_limiter.ip_dependency()),
):
    auth.forgot_password(data.email)
    return MessageResponse(message="If that email exists, a reset link has been sent")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    data: ResetPasswordRequest,
    response: Response,
    _rl: None = Depends(auth_sensitive_rate_limiter.ip_dependency()),
):
    auth.reset_password(data)
    # All sessions were revoked server-side; clear the caller's refresh cookie
    # so the browser doesn't hold a now-invalid token.
    _clear_refresh_cookie(response)
    return MessageResponse(message="Password updated successfully")
