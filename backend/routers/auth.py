from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.client_ip import get_client_ip
from core.config import settings
from core.controlbox import controlbox
from core.errors import INVALID_OR_EXPIRED_TOKEN, NO_REFRESH_TOKEN
from core.exceptions import AuthenticationError, ServiceError
from core.rate_limit import (
    auth_refresh_rate_limiter,
    send_otp_rate_limiter,
    verify_otp_rate_limiter,
)
from schemas.auth import (
    MessageResponse,
    SendOtpRequest,
    TokenResponse,
    VerifyOtpRequest,
)
from services.auth_service import auth

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_MAX_AGE = controlbox.authentication.session_cookie_days * 24 * 3600


# Fail fast in production without Secure cookies. The refresh token is a
# long-lived credential - if it leaves TLS an attacker can replay it for
# COOKIE_MAX_AGE. No silent downgrade; cookie_secure must be true in prod.
if settings.is_production and not settings.cookie_secure:
    raise RuntimeError(
        "COOKIE_SECURE must be true in production (environment=production). "
        "The refresh-token cookie cannot be served over plain HTTP."
    )


# Optional Bearer on logout so the cookie is always cleared even when the
# access token has expired or was never sent. Requiring Bearer would leave
# a stale (still valid) refresh cookie that the next app boot would replay.
_optional_bearer = HTTPBearer(auto_error=False)


# Scope the refresh cookie to the browser-visible refresh endpoint only.
# Narrower paths reduce CSRF / accidental-attach surface for the long-lived
# credential. Path comes from settings.refresh_cookie_path (default
# /auth/refresh; production same-origin API rewrites use /api/auth/refresh).
REFRESH_COOKIE_PATH = settings.refresh_cookie_path


def _refresh_cookie_domain(request: Request) -> str | None:
    """Use a host-only cookie when auth is proxied through the legacy frontend."""
    origin = request.headers.get("origin", "").rstrip("/")
    legacy_origins = {
        str(legacy_origin).rstrip("/")
        for legacy_origin in controlbox.authentication.legacy_frontend_origins
    }
    if origin in legacy_origins:
        return None
    return settings.cookie_domain or None


def _set_refresh_cookie(response: Response, refresh_token: str, request: Request) -> None:
    """Set the refresh token as an httpOnly cookie.

    ``secure`` is ``settings.cookie_secure`` OR ``is_production`` so a
    misconfigured env cannot serve a non-Secure cookie in production
    (paired with the startup assertion above).

    Cookie path is ``settings.refresh_cookie_path`` so the browser only
    attaches it to the refresh endpoint. Any future consumer must share
    that path or widen the scope here.
    """
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure or settings.is_production,
        path=REFRESH_COOKIE_PATH,
        max_age=COOKIE_MAX_AGE,
        domain=_refresh_cookie_domain(request),
    )


def _clear_refresh_cookie(response: Response, request: Request) -> None:
    """Clear the refresh token cookie (must match the Set-Cookie path)."""
    response.delete_cookie(
        key="refresh_token",
        path=REFRESH_COOKIE_PATH,
        domain=_refresh_cookie_domain(request),
    )


def _origin_allowed(request: Request) -> bool:
    """Return True if the request's Origin or Referer is in allowed origins.

    SameSite=Lax lets top-level cross-site POSTs attach the refresh cookie.
    Without a CSRF token we require a trusted origin - refuse if neither
    Origin nor Referer is set or if they fall outside ``settings.cors_origins``.
    """
    if not settings.cors_origins and not settings.cors_origin_regex:
        # No origins configured: reject cross-origin cookie-bearing POSTs.
        return False

    origin = request.headers.get("origin")
    if origin:
        return settings.is_allowed_origin(origin)

    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        referer_origin = (
            f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else referer
        )
        return settings.is_allowed_origin(referer_origin)

    # No Origin/Referer: treat as untrusted. Browsers send Origin on
    # cross-site POSTs; its absence is suspicious.
    return False


@router.post("/send-otp", response_model=MessageResponse)
def send_otp(
    data: SendOtpRequest,
    _rl: None = Depends(send_otp_rate_limiter.ip_dependency()),
):
    auth.send_otp(
        data.email,
        invitation_token=data.token,
        return_to=data.return_to,
    )
    return MessageResponse(message="Verification link and code sent successfully")


@router.post("/verify-otp", response_model=TokenResponse)
def verify_otp(
    data: VerifyOtpRequest,
    request: Request,
    response: Response,
    _rl: None = Depends(verify_otp_rate_limiter.ip_dependency()),
):
    result = auth.verify_otp(data.email, data.token)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token, request)
    return result.body


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
):
    # SameSite=Lax does not block top-level cross-site POSTs; require
    # Origin/Referer against CORS_ORIGINS as a CSRF fallback.
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
    auth_refresh_rate_limiter.check(get_client_ip(request))
    result = auth.refresh(refresh_token)
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token, request)
    return result.body


def _error_response_with_cleared_cookie(
    status_code: int,
    detail: str,
    request: Request,
) -> JSONResponse:
    """Build a JSONResponse that clears the refresh cookie.

    Used from /auth/logout so the cookie is cleared even when upstream
    revocation fails - raising from the route would drop Set-Cookie on
    the Response parameter.
    """
    resp = JSONResponse(status_code=status_code, content={"detail": detail})
    resp.delete_cookie(
        key="refresh_token",
        path=REFRESH_COOKIE_PATH,
        domain=_refresh_cookie_domain(request),
    )
    return resp


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    token: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """Log the user out.

    Bearer is optional: if the access token has expired, the refresh cookie
    is still cleared so the browser does not hold a replayable token.
    Even if upstream revocation fails, the cookie is cleared via a
    JSONResponse that carries Set-Cookie for ``refresh_token``.
    """
    if token is not None:
        try:
            auth.logout(token.credentials)
        except HTTPException as e:
            return _error_response_with_cleared_cookie(
                status_code=e.status_code,
                detail=str(e.detail) if e.detail is not None else INVALID_OR_EXPIRED_TOKEN,
                request=request,
            )
        except (AuthenticationError, ServiceError) as e:
            return _error_response_with_cleared_cookie(
                status_code=401 if isinstance(e, AuthenticationError) else 400,
                detail=e.detail,
                request=request,
            )
    _clear_refresh_cookie(response, request)
    return MessageResponse(message="Logged out successfully")
