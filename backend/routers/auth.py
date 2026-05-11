from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import settings
from core.errors import INVALID_OR_EXPIRED_TOKEN, NO_REFRESH_TOKEN
from core.exceptions import AuthenticationError, ServiceError
from core.rate_limit import (
    auth_refresh_rate_limiter,
    forgot_password_rate_limiter,
    login_rate_limiter,
    reset_password_rate_limiter,
    signup_rate_limiter,
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


# A1: Fail fast at import time when running in production without secure
# cookies.  The refresh token is a long-lived credential — if it ever leaves
# the TLS channel an attacker can replay it for up to 30 days.  We accept no
# operational toggle that silently downgrades this; the envar setting must be
# explicitly true (default) in prod.
if settings.is_production and not settings.cookie_secure:
    raise RuntimeError(
        "COOKIE_SECURE must be true in production (environment=production). "
        "The refresh-token cookie cannot be served over plain HTTP."
    )


# A11: allow optional Bearer for logout so the cookie is always cleared, even
# if the caller's access token has expired or was never sent.  If we required
# Bearer here, a user whose access token lapsed would be stuck with a stale
# (but still valid) refresh cookie that the next app boot would happily replay.
_optional_bearer = HTTPBearer(auto_error=False)


# A2: Scope the refresh cookie to the browser-visible refresh endpoint — the
# only route that needs it. Narrower paths reduce the number of requests that
# carry the long-lived credential, shrinking the CSRF / accidental-attach
# surface. Production Vercel rewrites use /api/auth/refresh.
REFRESH_COOKIE_PATH = settings.refresh_cookie_path


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set the refresh token as an httpOnly cookie.

    ``secure`` is set explicitly to ``settings.cookie_secure`` OR
    ``is_production`` so a misconfigured env var cannot serve a non-Secure
    cookie in production (A1 hardening — paired with the startup assertion
    above).

    A2: the cookie path is ``/auth/refresh`` so the browser only attaches
    it to the single endpoint that actually reads it.  Any future endpoint
    that needs the refresh cookie must be placed under this exact path or
    explicitly widen the scope here.
    """
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure or settings.is_production,
        path=REFRESH_COOKIE_PATH,
        max_age=COOKIE_MAX_AGE,
        domain=settings.cookie_domain or None,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Clear the refresh token cookie (must match the Set-Cookie path)."""
    response.delete_cookie(
        key="refresh_token",
        path=REFRESH_COOKIE_PATH,
        domain=settings.cookie_domain or None,
    )


def _origin_allowed(request: Request) -> bool:
    """Return True if the request's Origin or Referer is in allowed origins.

    A32: SameSite=Lax lets top-level cross-site POSTs attach the refresh
    cookie.  Without a CSRF token we require that the request originated
    from a trusted origin — refuse if neither Origin nor Referer is set
    or if they point outside ``settings.cors_origins``.
    """
    allowed = set(settings.cors_origins or [])
    if not allowed:
        # No origins configured → be conservative and reject cross-origin
        # cookie-bearing POSTs regardless.
        return False

    origin = request.headers.get("origin")
    if origin:
        return origin in allowed

    referer = request.headers.get("referer")
    if referer:
        return any(referer.startswith(o + "/") or referer == o for o in allowed)

    # No Origin/Referer at all — treat as untrusted.  Browsers always send
    # Origin on cross-site POSTs; its absence is suspicious.
    return False


@router.post("/signup", response_model=SignupResponse)
def signup(
    data: SignupRequest,
    response: Response,
    _rl: None = Depends(signup_rate_limiter.ip_dependency()),
):
    result = auth.signup(data)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token)
    return result.body


@router.post("/login", response_model=TokenResponse)
def login(
    data: LoginRequest,
    response: Response,
    _rl: None = Depends(login_rate_limiter.ip_dependency()),
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
    # A32: require that the request originated from a trusted origin.
    # SameSite=Lax does not block top-level cross-site POSTs, so without
    # a custom header / double-submit token we fall back to Origin/Referer
    # validation against CORS_ORIGINS.
    if not _origin_allowed(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-origin refresh blocked",
        )
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


def _error_response_with_cleared_cookie(
    status_code: int, detail: str,
) -> JSONResponse:
    """Build a JSONResponse that clears the refresh cookie.

    Used from /auth/logout to guarantee the cookie is cleared even when
    upstream revocation fails — raising an exception from the route would
    otherwise drop the cookie header set on the Response parameter.
    """
    resp = JSONResponse(status_code=status_code, content={"detail": detail})
    resp.delete_cookie(
        key="refresh_token",
        path=REFRESH_COOKIE_PATH,
        domain=settings.cookie_domain or None,
    )
    return resp


@router.post("/logout", response_model=MessageResponse)
def logout(
    response: Response,
    token: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """Log the user out.

    A11: Bearer is optional — if the access token has expired, the refresh
    cookie is still cleared so the browser doesn't hold a replayable token.
    Even if upstream revocation fails, the cookie is still cleared; we
    surface the error via a JSONResponse that carries Set-Cookie for
    ``refresh_token``.
    """
    if token is not None:
        try:
            auth.logout(token.credentials)
        except HTTPException as e:
            return _error_response_with_cleared_cookie(
                status_code=e.status_code,
                detail=str(e.detail) if e.detail is not None else INVALID_OR_EXPIRED_TOKEN,
            )
        except (AuthenticationError, ServiceError) as e:
            # Map to 401 for AuthenticationError (consistent with global handler).
            return _error_response_with_cleared_cookie(
                status_code=401 if isinstance(e, AuthenticationError) else 400,
                detail=e.detail,
            )
    _clear_refresh_cookie(response)
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    data: ForgotPasswordRequest,
    _rl: None = Depends(forgot_password_rate_limiter.ip_dependency()),
):
    auth.forgot_password(data.email)
    return MessageResponse(message="If that email exists, a reset link has been sent")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    data: ResetPasswordRequest,
    response: Response,
    _rl: None = Depends(reset_password_rate_limiter.ip_dependency()),
):
    auth.reset_password(data)
    # All sessions were revoked server-side; clear the caller's refresh cookie
    # so the browser doesn't hold a now-invalid token.
    _clear_refresh_cookie(response)
    return MessageResponse(message="Password updated successfully")
