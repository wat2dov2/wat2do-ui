"""Global exception handlers for unhandled errors.

These handlers catch exceptions that escape route/service code.
If a route needs custom behavior for an exception (e.g., graceful
degradation), catch it locally — local catches always take priority.
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

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AuthApiError)
    async def handle_auth_api_error(request: Request, exc: AuthApiError) -> JSONResponse:
        status_code = exc.status or 400
        detail = exc.message or AUTHENTICATION_ERROR
        logger.warning(
            "AuthApiError on %s %s [code=%s]: %s",
            request.method, request.url.path, exc.code, detail,
        )
        return JSONResponse(status_code=status_code, content={"detail": detail})

    @app.exception_handler(APIError)
    async def handle_postgrest_error(request: Request, exc: APIError) -> JSONResponse:
        mapped = PG_CODE_TO_HTTP.get(exc.code or "")
        if mapped:
            status_code, detail = mapped
            logger.warning(
                "PostgREST error on %s %s [pg_code=%s]: %s",
                request.method, request.url.path, exc.code, exc.message,
            )
        else:
            status_code = 502
            detail = DB_OPERATION_FAILED
            logger.error(
                "Unhandled PostgREST error on %s %s [code=%s]: %s | hint=%s | details=%s",
                request.method, request.url.path,
                exc.code, exc.message, exc.hint, exc.details,
            )
        return JSONResponse(status_code=status_code, content={"detail": detail})

    @app.exception_handler(Exception)
    async def handle_generic_exception(request: Request, exc: Exception) -> JSONResponse:
        if app.debug:
            raise exc
        logger.error(
            "Unhandled %s on %s %s:\n%s",
            type(exc).__name__, request.method, request.url.path,
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": INTERNAL_SERVER_ERROR},
        )
