"""In-memory rate limiter for FastAPI endpoints.

Uses a sliding-window counter stored in a plain dict.  Suitable for
single-process deployments; swap for Redis-backed storage if running
behind multiple workers.

Usage (authenticated, keyed by user ID)::

    from core.rate_limit import RateLimiter

    ai_limiter = RateLimiter(max_requests=10, window_seconds=60)

    @router.post("/expensive")
    def expensive(user: dict = Depends(get_current_user),
                  _rl: None = Depends(ai_limiter.dependency())):
        ...

Usage (unauthenticated, keyed by client IP)::

    from core.rate_limit import RateLimiter

    auth_limiter = RateLimiter(max_requests=5, window_seconds=60)

    @router.post("/login")
    def login(request: Request,
              _rl: None = Depends(auth_limiter.ip_dependency())):
        ...

The ``dependency()`` method reads the user dict injected by
``get_current_user`` and tracks calls per ``user["id"]``.

The ``ip_dependency()`` method reads the client IP from ``Request``
and tracks calls per IP address — suitable for unauthenticated
endpoints like login, signup, and password reset.
"""

import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import Depends, HTTPException, Request, status

from core.auth import get_current_user
from core.constants import (
    AUTH_RATE_LIMIT_MAX_REQUESTS,
    AUTH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS,
    AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
    AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import RATE_LIMIT_EXCEEDED

log = logging.getLogger(__name__)


class RateLimiter:
    """Sliding-window rate limiter keyed by authenticated user ID."""

    def __init__(
        self,
        max_requests: int = RATE_LIMIT_MAX_REQUESTS,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # {user_id: [timestamp, ...]}
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _cleanup(self, user_id: str, now: float) -> None:
        """Remove timestamps outside the current window (must hold lock)."""
        cutoff = now - self.window_seconds
        timestamps = self._requests[user_id]
        # Find first index within the window and slice
        idx = 0
        for idx, ts in enumerate(timestamps):
            if ts > cutoff:
                break
        else:
            # All entries are expired
            idx = len(timestamps)
        if idx:
            self._requests[user_id] = timestamps[idx:]

    def _check(self, user_id: str) -> None:
        """Raise 429 if the user has exceeded their request quota."""
        now = time.monotonic()
        with self._lock:
            self._cleanup(user_id, now)
            if len(self._requests[user_id]) >= self.max_requests:
                log.warning(
                    "Rate limit exceeded for user %s (%d/%d in %ds)",
                    user_id,
                    len(self._requests[user_id]),
                    self.max_requests,
                    self.window_seconds,
                )
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=RATE_LIMIT_EXCEEDED,
                )
            self._requests[user_id].append(now)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def dependency(self):
        """Return a FastAPI dependency that enforces the rate limit.

        The dependency requires ``get_current_user`` so the user dict is
        available for keying.  Include it *after* ``get_current_user`` in
        the endpoint signature.
        """

        async def _rate_limit_dep(
            user: dict = Depends(get_current_user),
        ) -> None:
            self._check(user["id"])

        return _rate_limit_dep

    def ip_dependency(self):
        """Return a FastAPI dependency that enforces the rate limit by client IP.

        Suitable for unauthenticated endpoints (login, signup, password
        reset) where there is no user ID to key on.  Uses
        ``request.client.host`` as the key.
        """

        async def _ip_rate_limit_dep(request: Request) -> None:
            client_ip = request.client.host if request.client else "unknown"
            self._check(client_ip)

        return _ip_rate_limit_dep


# ---------------------------------------------------------------------------
# Pre-built limiters (importable singletons)
# ---------------------------------------------------------------------------
ai_rate_limiter = RateLimiter()

# Auth endpoints: stricter limits to prevent credential stuffing / brute force.
# login & signup: 10 attempts per 60 seconds per IP.
auth_rate_limiter = RateLimiter(
    max_requests=AUTH_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_RATE_LIMIT_WINDOW_SECONDS,
)
# forgot-password & reset-password: very strict to prevent email-bomb abuse.
auth_sensitive_rate_limiter = RateLimiter(
    max_requests=AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
)
# refresh: more generous since legitimate clients auto-refresh frequently.
auth_refresh_rate_limiter = RateLimiter(
    max_requests=AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS,
)
