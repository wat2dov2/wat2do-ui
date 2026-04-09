"""In-memory sliding-window rate limiter for FastAPI endpoints.

Uses a sliding-window counter stored in a plain dict.  Suitable for
single-process deployments.  For multi-worker setups, replace the
in-memory dict with a Redis-backed store (SORTED SET + ZRANGEBYSCORE)
without changing the public API — only ``_cleanup`` and ``_check``
need a new backend.

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
endpoints like login, signup, and QR scans.
"""

import logging
import math
import time
from collections import defaultdict
from threading import Lock

from fastapi import Depends, HTTPException, Request, status

from core.auth import get_current_user
from core.constants import (
    ANON_INTERACTION_RATE_LIMIT_MAX_REQUESTS,
    ANON_INTERACTION_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_RATE_LIMIT_MAX_REQUESTS,
    AUTH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS,
    AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
    AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
    QR_SCAN_RATE_LIMIT_MAX_REQUESTS,
    QR_SCAN_RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import RATE_LIMIT_EXCEEDED

log = logging.getLogger(__name__)


class RateLimiter:
    """Sliding-window rate limiter keyed by an arbitrary string (user ID, IP, etc.).

    Stores ``(key -> [monotonic timestamps])`` in a dict guarded by a
    threading lock.  Each call to ``_check`` prunes expired entries,
    then either records the new request or raises 429 with a
    ``Retry-After`` header indicating how many seconds until the
    oldest request in the window expires.
    """

    def __init__(
        self,
        max_requests: int = RATE_LIMIT_MAX_REQUESTS,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # {key: [timestamp, ...]}
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _cleanup(self, key: str, now: float) -> None:
        """Remove timestamps outside the current window (must hold lock)."""
        cutoff = now - self.window_seconds
        timestamps = self._requests[key]
        # Find first index within the window and slice
        idx = 0
        for idx, ts in enumerate(timestamps):
            if ts > cutoff:
                break
        else:
            # All entries are expired
            idx = len(timestamps)
        if idx:
            self._requests[key] = timestamps[idx:]

    def _check(self, key: str) -> None:
        """Raise 429 if *key* has exceeded its request quota.

        The 429 response includes a ``Retry-After`` header (seconds)
        so well-behaved clients know when to retry.
        """
        now = time.monotonic()
        with self._lock:
            self._cleanup(key, now)
            if len(self._requests[key]) >= self.max_requests:
                # Earliest request still in window — time until it expires
                oldest = self._requests[key][0]
                retry_after = max(1, math.ceil((oldest + self.window_seconds) - now))
                log.warning(
                    "Rate limit exceeded for %s (%d/%d in %ds, retry_after=%ds)",
                    key,
                    len(self._requests[key]),
                    self.max_requests,
                    self.window_seconds,
                    retry_after,
                )
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=RATE_LIMIT_EXCEEDED,
                    headers={"Retry-After": str(retry_after)},
                )
            self._requests[key].append(now)

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

        Suitable for unauthenticated endpoints (login, signup, QR scans)
        where there is no user ID to key on.  Uses
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
# Anonymous interaction batches (POST /interactions/batch without auth).
# Legitimate frontends fire view/impression events on scroll — generous limit
# but stops bots from flooding the interactions table.
anon_interaction_rate_limiter = RateLimiter(
    max_requests=ANON_INTERACTION_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=ANON_INTERACTION_RATE_LIMIT_WINDOW_SECONDS,
)
# QR scan recording (GET /qr/{id}).  Normal usage is one scan per poster;
# repeated rapid scans from the same IP are clearly automated.
qr_scan_rate_limiter = RateLimiter(
    max_requests=QR_SCAN_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=QR_SCAN_RATE_LIMIT_WINDOW_SECONDS,
)
