"""Domain exceptions for service-layer errors.

Services raise these instead of fastapi.HTTPException so they stay
decoupled from HTTP concerns.  Routers (or the global error handlers)
translate them into appropriate HTTP responses.
"""

from typing import TypeVar


class ServiceError(Exception):
    """Base for all domain exceptions raised by services."""

    def __init__(self, detail: str, *, code: str = ""):
        self.detail = detail
        self.code = code
        super().__init__(detail)


class NotFoundError(ServiceError):
    """Resource does not exist."""


class AuthenticationError(ServiceError):
    """Credentials invalid or session expired."""


class AuthorizationError(ServiceError):
    """Caller lacks permission (e.g. email not allowed)."""


class ConflictError(ServiceError):
    """Resource already exists or unique constraint violated."""


class ValidationError(ServiceError):
    """Input failed a business rule (bad package, insufficient credits, …)."""


class RateLimitExceeded(Exception):
    """Raised when a rate limit is exceeded.

    Carries *retry_after* (seconds) so the HTTP handler can set the
    ``Retry-After`` header without knowing rate-limiter internals.
    """

    def __init__(self, detail: str, *, retry_after: int = 1):
        super().__init__(detail)
        self.detail = detail
        self.retry_after = retry_after


T = TypeVar("T")


def get_or_404(result: T | None, detail: str) -> T:
    """Return *result* if truthy, otherwise raise ``NotFoundError``.

    Replaces the repetitive ``if not resource: raise HTTPException(404, ...)``
    pattern across routers.  Uses a truthiness check (not strict ``is None``)
    so that ``False`` / ``0`` / empty containers also trigger the 404 --
    matching the original ``if not resource`` guard.
    """
    if not result:
        raise NotFoundError(detail)
    return result


class AIServiceError(Exception):
    """Raised when AI service encounters an error.

    *error_kind* classifies the failure so the global error handler can
    map it to the right HTTP status without substring-matching the message:
    - ``"config"`` — missing API key / misconfiguration  (503)
    - ``"parse"``  — AI returned unparseable JSON        (502)
    - ``"api"``    — empty/bad response from upstream API (502)
    """

    def __init__(
        self,
        message: str,
        *,
        error_kind: str = "api",
        # Kept for backward compat during transition; new call sites
        # should use error_kind="config" instead.
        is_config_error: bool = False,
    ):
        super().__init__(message)
        if is_config_error:
            self.error_kind = "config"
        else:
            self.error_kind = error_kind
        self.is_config_error = self.error_kind == "config"
