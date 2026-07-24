"""In-memory sliding-window rate limiter for FastAPI endpoints.

Uses a sliding-window counter stored in a plain dict.  Suitable for
single-process deployments.  For multi-worker setups, replace the
in-memory dict with a Redis-backed store (SORTED SET + ZRANGEBYSCORE)
without changing the public API - only ``_cleanup`` and ``_check``
need a new backend.

============================================================================
**CRITICAL - SINGLE-PROCESS ONLY.**
============================================================================
Every ``RateLimiter`` instance keeps its state in process-local memory
guarded by a ``threading.Lock``.  The limiter is *NOT SAFE* under any of
the following conditions:

  * Multiple workers (``uvicorn --workers N``, gunicorn -w N,
    multiple container replicas): each worker holds an independent
    copy of the state, so the effective cap becomes
    ``max_requests * N_workers``.  Brute-force, credential-stuffing,
    and scrape-rate budgets silently multiply with worker count.
  * Process restarts / rolling deploys: state is lost, so an attacker
    can simply wait for a redeploy to flush accumulated counts.

**Before scaling past a single worker, replace the backend with Redis
(or any shared store).** The public API is stable; only ``_cleanup``
and ``check`` need a new implementation.

A startup warning is emitted below if ``UVICORN_WORKERS`` (or gunicorn's
``WEB_CONCURRENCY`` / ``GUNICORN_CMD_ARGS``) indicates >1 worker.  The
warning is *best-effort* - it only detects well-known env conventions.
============================================================================

Usage (authenticated, keyed by user ID)::

    from core.rate_limit import RateLimiter
    from core.auth import get_current_user

    ai_limiter = RateLimiter(max_requests=10, window_seconds=60)

    def _user_id_key(user: dict = Depends(get_current_user)) -> str:
        return user["id"]

    @router.post("/expensive")
    def expensive(user: dict = Depends(get_current_user),
                  _rl: None = Depends(ai_limiter.dependency(key_func=_user_id_key))):
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

The ``ip_dependency()`` method resolves the real client IP via
``core.client_ip.get_client_ip()`` (proxy-aware) and tracks calls
per IP - suitable for unauthenticated endpoints like login, signup,
and QR scans.
"""

import logging
import math
import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import Depends, Request

from core.client_ip import get_client_ip
from core.constants import (
    ANON_INTERACTION_RATE_LIMIT_MAX_REQUESTS,
    ANON_INTERACTION_RATE_LIMIT_WINDOW_SECONDS,
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
from core.exceptions import RateLimitExceeded

log = logging.getLogger(__name__)


def _warn_on_multiworker_deploy() -> None:
    """Best-effort check: warn loudly if the runtime looks multi-worker.

    The in-memory limiter's state does not survive across workers (see
    module docstring).  Inspect the usual suspects (``UVICORN_WORKERS``,
    ``WEB_CONCURRENCY``, ``GUNICORN_WORKERS``) and log a warning so
    operators see the footgun in stderr.
    """
    env_keys = ("UVICORN_WORKERS", "WEB_CONCURRENCY", "GUNICORN_WORKERS")
    for key in env_keys:
        raw = os.environ.get(key)
        if not raw:
            continue
        try:
            workers = int(raw)
        except (TypeError, ValueError):
            continue
        if workers > 1:
            log.warning(
                "%s=%d detected, but the in-memory rate limiter only shares "
                "state within a single process. With >1 worker the effective "
                "cap is multiplied by N_workers - swap to a Redis-backed "
                "store before scaling (see core/rate_limit.py docstring).",
                key,
                workers,
            )
            return


_warn_on_multiworker_deploy()


class RateLimiter:
    """Sliding-window rate limiter keyed by an arbitrary string (user ID, IP, etc.).

    Stores ``(key -> [monotonic timestamps])`` in a dict guarded by a
    threading lock.  Each call to ``_check`` prunes expired entries for
    the requested key, then either records the new request or raises 429
    with a ``Retry-After`` header indicating how many seconds until the
    oldest request in the window expires.

    **Stale-key pruning:** To prevent unbounded memory growth from
    one-off IPs (or users) that never return, a full sweep of all keys
    runs every ``_PRUNE_INTERVAL`` seconds (default: 5 minutes).  The
    sweep removes any key whose timestamp list is empty or fully
    expired.  This keeps memory proportional to *active* clients rather
    than *all-time unique* clients.

    **Single-process only** - see module docstring for details.
    """

    # How often (seconds) to do a full sweep of all keys.  Trades a
    # small amount of latency on one request (the one that triggers the
    # sweep) for bounded memory.  5 minutes is conservative; even at
    # 100k stale keys the sweep is < 1 ms.
    _PRUNE_INTERVAL: float = 300.0

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
        self._last_prune: float = time.monotonic()

    def _cleanup(self, key: str, now: float) -> None:
        """Remove timestamps outside the current window (must hold lock).

        If all timestamps for *key* are expired (or the key has no
        timestamps), the key is deleted from the dict entirely so it
        doesn't linger as an empty list.
        """
        timestamps = self._requests.get(key)
        if not timestamps:
            # Key absent or empty - nothing to clean.  Avoid touching
            # the defaultdict so we don't create a phantom empty entry.
            self._requests.pop(key, None)
            return
        cutoff = now - self.window_seconds
        # Find first index within the window and slice
        idx = 0
        for idx, ts in enumerate(timestamps):
            if ts > cutoff:
                break
        else:
            # All entries are expired - remove the key entirely.
            del self._requests[key]
            return
        if idx:
            self._requests[key] = timestamps[idx:]

    def _maybe_prune_all(self, now: float) -> None:
        """Sweep all keys and remove those with no valid timestamps (must hold lock).

        Only runs when ``_PRUNE_INTERVAL`` seconds have elapsed since the
        last sweep.  The cost is O(n) in the number of keys, but runs
        infrequently (default every 5 min) so amortised impact is negligible.
        """
        if now - self._last_prune < self._PRUNE_INTERVAL:
            return
        self._last_prune = now
        cutoff = now - self.window_seconds
        stale_keys = [
            k for k, ts_list in self._requests.items() if not ts_list or ts_list[-1] <= cutoff
        ]
        for k in stale_keys:
            del self._requests[k]
        if stale_keys:
            log.debug(
                "Rate limiter pruned %d stale keys, %d remaining",
                len(stale_keys),
                len(self._requests),
            )

    def check(self, key: str) -> None:
        """Raise 429 if *key* has exceeded its request quota.

        The 429 response includes a ``Retry-After`` header (seconds)
        so well-behaved clients know when to retry.
        """
        now = time.monotonic()
        with self._lock:
            self._maybe_prune_all(now)
            self._cleanup(key, now)
            if len(self._requests[key]) >= self.max_requests:
                # Earliest request still in window - time until it expires
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
                raise RateLimitExceeded(
                    RATE_LIMIT_EXCEEDED,
                    retry_after=retry_after,
                )
            self._requests[key].append(now)

    def dependency(self, key_func=None):
        """Return a FastAPI dependency that enforces the rate limit.

        *key_func* is an optional FastAPI dependency that returns the string
        key to rate-limit by (e.g. a dependency that extracts the user ID
        from the auth token).  When omitted, the client IP address is used
        as the key, making the limiter auth-agnostic.

        Routers that want per-user limiting should pass a dependency that
        extracts the user ID, e.g.::

            def _user_id_key(user: dict = Depends(get_current_user)) -> str:
                return user["id"]

            _rl: None = Depends(ai_limiter.dependency(key_func=_user_id_key))
        """
        if key_func is None:

            async def _rate_limit_dep(request: Request) -> None:
                self.check(get_client_ip(request))
        else:

            async def _rate_limit_dep(key: str = Depends(key_func)) -> None:
                self.check(key)

        return _rate_limit_dep

    def ip_dependency(self):
        """Return a FastAPI dependency that enforces the rate limit by client IP.

        Suitable for unauthenticated endpoints (login, signup, QR scans)
        where there is no user ID to key on.  Uses ``get_client_ip()``
        to resolve the real client address behind a reverse proxy.
        """

        async def _ip_rate_limit_dep(request: Request) -> None:
            self.check(get_client_ip(request))

        return _ip_rate_limit_dep


# ---------------------------------------------------------------------------
# Pre-built limiters (importable singletons)
# ---------------------------------------------------------------------------
# Each endpoint gets its OWN limiter instance.  Using the same instance
# for multiple endpoints (e.g. login + signup sharing one bucket) causes
# legitimate users at shared IPs (corporate NAT, mobile carriers) to be
# blocked across unrelated endpoints: a signup brute-force from another user
# behind the same NAT would lock out login too.  Separating the buckets keeps
# each endpoint's budget independent.
ai_generate_filters_rate_limiter = RateLimiter()
ai_generate_event_rate_limiter = RateLimiter()
ai_parse_event_image_rate_limiter = RateLimiter()
# Auth endpoints: stricter limits to prevent credential stuffing / brute force.
# send-otp & verify-otp: strict to prevent email-bomb and brute-force abuse.
# Separate buckets so a send burst does not block verification.
send_otp_rate_limiter = RateLimiter(
    max_requests=AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
)
verify_otp_rate_limiter = RateLimiter(
    max_requests=AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS,
)
# refresh: more generous since legitimate clients auto-refresh frequently.
auth_refresh_rate_limiter = RateLimiter(
    max_requests=AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS,
)
# Anonymous interaction batches (POST /interactions/batch without auth).
# Legitimate frontends fire view/impression events on scroll - generous limit
# but stops bots from flooding the interactions table.
anon_interaction_rate_limiter = RateLimiter(
    max_requests=ANON_INTERACTION_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=ANON_INTERACTION_RATE_LIMIT_WINDOW_SECONDS,
)
# QR scan recording (GET /qr/{id}).  Normal usage is one scan per QR code;
# repeated rapid scans from the same IP are clearly automated.
qr_scan_rate_limiter = RateLimiter(
    max_requests=QR_SCAN_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=QR_SCAN_RATE_LIMIT_WINDOW_SECONDS,
)
