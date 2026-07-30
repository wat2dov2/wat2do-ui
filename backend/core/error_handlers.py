"""Global exception handlers for unhandled errors.

These handlers catch exceptions that escape route/service code.
If a route needs custom behavior for an exception (e.g., graceful
degradation), catch it locally - local catches always take priority.

**Log-injection defence.** Upstream error payloads can contain raw
user input (email, URL, free-text).  Before interpolating any
``exc.message`` / ``exc.details`` / ``exc.hint`` into a log line we pass
it through :func:`_safe` which strips CR/LF so a malicious input cannot
forge a second log line that looks authentic (e.g. inject a fake
``login succeeded`` row).
"""

import logging
import traceback

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError

from core.errors import (
    AUTHENTICATION_ERROR,
    DB_OPERATION_FAILED,
    INTERNAL_SERVER_ERROR,
    PG_CODE_TO_HTTP,
)
from core.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    NotFoundError,
    RateLimitExceeded,
    ServiceError,
    ValidationError,
)

logger = logging.getLogger(__name__)


def _safe(value: object) -> str:
    """Return *value* rendered as a single-line string for safe logging.

    Strips CR/LF so an attacker-controlled field (email, message,
    hint, details) cannot inject a forged log line.  Non-string
    values are coerced via ``str()`` first; ``None`` becomes ``""``.
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    return text.replace("\r", "\\r").replace("\n", "\\n")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def handle_not_found(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": exc.detail})

    @app.exception_handler(AuthenticationError)
    async def handle_authentication_error(
        request: Request, exc: AuthenticationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"detail": exc.detail},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(AuthorizationError)
    async def handle_authorization_error(request: Request, exc: AuthorizationError) -> JSONResponse:
        return JSONResponse(status_code=403, content={"detail": exc.detail})

    @app.exception_handler(ConflictError)
    async def handle_conflict_error(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": exc.detail})

    @app.exception_handler(ValidationError)
    async def handle_validation_error(request: Request, exc: ValidationError) -> JSONResponse:
        # Expose ``code`` in the error body so clients can branch on a
        # stable machine-readable field instead of substring-matching the
        # human-readable ``detail``.  Empty code is omitted for exceptions
        # that only carry a detail message.
        body: dict[str, object] = {"detail": exc.detail}
        if exc.code:
            body["code"] = exc.code
        return JSONResponse(status_code=400, content=body)

    @app.exception_handler(ServiceError)
    async def handle_service_error(request: Request, exc: ServiceError) -> JSONResponse:
        # ``exc.detail`` can carry caller-supplied content when the
        # service re-raises with context - sanitize before logging.
        logger.warning(
            "Unhandled ServiceError on %s %s: %s",
            request.method,
            request.url.path,
            _safe(exc.detail),
        )
        body: dict[str, object] = {"detail": exc.detail}
        if exc.code:
            body["code"] = exc.code
        return JSONResponse(status_code=400, content=body)

    @app.exception_handler(AuthApiError)
    async def handle_auth_api_error(request: Request, exc: AuthApiError) -> JSONResponse:
        status_code = exc.status or 400
        # Log the real Supabase message server-side for debugging, but never
        # send it to the client - raw messages like "User already registered"
        # or "Email not confirmed" enable user-enumeration attacks.
        # Sanitize the upstream message (CR/LF) before interpolation
        # so a compromised/hostile upstream cannot forge log lines.
        logger.warning(
            "AuthApiError on %s %s [code=%s]: %s",
            request.method,
            request.url.path,
            _safe(exc.code),
            _safe(exc.message),
        )
        return JSONResponse(status_code=status_code, content={"detail": AUTHENTICATION_ERROR})

    @app.exception_handler(APIError)
    async def handle_postgrest_error(request: Request, exc: APIError) -> JSONResponse:
        mapped = PG_CODE_TO_HTTP.get(exc.code or "")
        if mapped:
            status_code, detail = mapped
            logger.warning(
                "PostgREST error on %s %s [pg_code=%s]: %s",
                request.method,
                request.url.path,
                _safe(exc.code),
                _safe(exc.message),
            )
        else:
            status_code = 502
            detail = DB_OPERATION_FAILED
            # The high-level identifier is safe at ERROR level for alerting,
            # but PostgREST's ``hint`` and ``details`` frequently embed raw row
            # data (including PII / the conflicting column value).  Downgrade
            # those fields to DEBUG so they never land in shared log sinks by
            # default, and sanitize before logging to prevent CR/LF injection.
            logger.error(
                "Unhandled PostgREST error on %s %s [code=%s]: %s",
                request.method,
                request.url.path,
                _safe(exc.code),
                _safe(exc.message),
            )
            logger.debug(
                "PostgREST error extra for %s %s: hint=%s | details=%s",
                request.method,
                request.url.path,
                _safe(exc.hint),
                _safe(exc.details),
            )
        return JSONResponse(status_code=status_code, content={"detail": detail})

    @app.exception_handler(RateLimitExceeded)
    async def handle_rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": exc.detail},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @app.exception_handler(Exception)
    async def handle_generic_exception(request: Request, exc: Exception) -> JSONResponse:
        if app.debug:
            raise exc
        logger.error(
            "Unhandled %s on %s %s:\n%s",
            type(exc).__name__,
            request.method,
            request.url.path,
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": INTERNAL_SERVER_ERROR},
        )
