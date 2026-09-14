import base64
import json
from urllib.parse import urlencode, urlparse

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.client_ip import get_client_ip
from core.config import settings
from core.constants import MAX_URL_LENGTH
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
    validate_safe_return_to,
)
from services.auth_service import auth
from services.email_service import email_service
from services.school_context import school_from_frontend_url


def _request_school(request: Request) -> str | None:
    return school_from_frontend_url(
        request.headers.get("origin") or request.headers.get("referer") or ""
    )


router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_MAX_AGE = controlbox.authentication.session_cookie_days * 24 * 3600
GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state"
GOOGLE_OAUTH_STATE_MAX_AGE = 10 * 60
GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/google/callback"


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


def _validate_google_callback_url(callback_url: str) -> str:
    parsed = urlparse(callback_url)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    if (
        parsed.scheme not in {"http", "https"}
        or not settings.is_allowed_origin(origin)
        or parsed.path != GOOGLE_OAUTH_CALLBACK_PATH
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid Google OAuth callback URL",
        )
    return callback_url


def _encode_google_oauth_state(payload: dict[str, str | None]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_google_oauth_state(value: str | None) -> dict[str, str | None] | None:
    if not value:
        return None
    try:
        raw = base64.urlsafe_b64decode(value.encode("ascii"))
        payload = json.loads(raw)
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    verifier = payload.get("code_verifier")
    callback_url = payload.get("callback_url")
    return_to = payload.get("return_to")
    if not isinstance(verifier, str) or not isinstance(callback_url, str):
        return None
    if return_to is not None and not isinstance(return_to, str):
        return None
    return {
        "code_verifier": verifier,
        "callback_url": callback_url,
        "return_to": return_to,
    }


def _oauth_frontend_url(
    callback_url: str,
    path: str,
    params: dict[str, str] | None = None,
) -> str:
    parsed = urlparse(callback_url)
    query = f"?{urlencode(params)}" if params else ""
    return f"{parsed.scheme}://{parsed.netloc}{path}{query}"


def _clear_google_oauth_state_cookie(
    response: Response,
    request: Request,
) -> None:
    response.delete_cookie(
        key=GOOGLE_OAUTH_STATE_COOKIE,
        path=GOOGLE_OAUTH_CALLBACK_PATH,
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


@router.get("/google", response_class=RedirectResponse)
def start_google_oauth(
    request: Request,
    callback_url: str = Query(..., max_length=MAX_URL_LENGTH),
    return_to: str | None = Query(default=None, max_length=MAX_URL_LENGTH),
    _rl: None = Depends(send_otp_rate_limiter.ip_dependency()),
):
    callback_url = _validate_google_callback_url(callback_url)
    try:
        safe_return_to = validate_safe_return_to(return_to)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    result = auth.prepare_google_oauth(callback_url)
    state = _encode_google_oauth_state(
        {
            "code_verifier": result.code_verifier,
            "callback_url": callback_url,
            "return_to": safe_return_to,
        }
    )
    response = RedirectResponse(result.authorization_url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        key=GOOGLE_OAUTH_STATE_COOKIE,
        value=state,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure or settings.is_production,
        path=GOOGLE_OAUTH_CALLBACK_PATH,
        max_age=GOOGLE_OAUTH_STATE_MAX_AGE,
        domain=_refresh_cookie_domain(request),
    )
    return response


@router.get("/google/callback", response_class=RedirectResponse)
def complete_google_oauth(
    request: Request,
    code: str | None = Query(default=None, max_length=MAX_URL_LENGTH),
    error: str | None = Query(default=None, max_length=255),
    _rl: None = Depends(verify_otp_rate_limiter.ip_dependency()),
):
    state_payload = _decode_google_oauth_state(request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE))
    fallback_callback_url = f"{settings.frontend_url.rstrip('/')}{GOOGLE_OAUTH_CALLBACK_PATH}"
    callback_url = (
        state_payload.get("callback_url") if state_payload is not None else fallback_callback_url
    )

    try:
        callback_url = _validate_google_callback_url(callback_url)
    except HTTPException:
        callback_url = fallback_callback_url
        state_payload = None

    if error or not code or state_payload is None:
        response = RedirectResponse(
            _oauth_frontend_url(
                callback_url,
                "/login",
                {"oauthError": "google"},
            ),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _clear_google_oauth_state_cookie(response, request)
        return response

    try:
        result = auth.verify_google_oauth(
            code,
            state_payload["code_verifier"] or "",
            callback_url,
        )
    except ServiceError:
        response = RedirectResponse(
            _oauth_frontend_url(
                callback_url,
                "/login",
                {"oauthError": "google"},
            ),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _clear_google_oauth_state_cookie(response, request)
        return response

    callback_params = {
        "oauth": "google",
        "school": result.body.school or "",
        "onboardingRequired": "true" if result.body.onboarding_required else "false",
    }
    return_to = state_payload.get("return_to")
    if return_to:
        callback_params["returnTo"] = return_to
    response = RedirectResponse(
        _oauth_frontend_url(callback_url, "/auth/callback", callback_params),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    if result.refresh_token:
        _set_refresh_cookie(response, result.refresh_token, request)
    _clear_google_oauth_state_cookie(response, request)
    return response


@router.post("/send-otp", response_model=MessageResponse)
def send_otp(
    data: SendOtpRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _rl: None = Depends(send_otp_rate_limiter.ip_dependency()),
):
    message = auth.prepare_otp_email(
        data.email,
        invitation_token=data.token,
        return_to=data.return_to,
        signup_school=_request_school(request),
    )
    background_tasks.add_task(email_service.send_safely, message)
    return MessageResponse(message="Verification link and code sent successfully")


@router.post("/verify-otp", response_model=TokenResponse)
def verify_otp(
    data: VerifyOtpRequest,
    request: Request,
    response: Response,
    _rl: None = Depends(verify_otp_rate_limiter.ip_dependency()),
):
    result = auth.verify_otp(data.email, data.token, signup_school=_request_school(request))
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
