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
    pass


class AuthenticationError(ServiceError):
    pass


class AuthorizationError(ServiceError):
    pass


class ConflictError(ServiceError):
    pass


class ValidationError(ServiceError):
    pass


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
