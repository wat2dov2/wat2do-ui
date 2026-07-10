"""Minimal thread-safe TTL cache for expensive shared queries.

Provides the get/set/expired pattern used by interaction_service,
saved_event_service, and recommendation_service so the double-check
locking boilerplate lives in one place.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Callable, TypeVar

T = TypeVar("T")
DEFAULT_MAX_SIZE = 1024

# Sentinel used internally to distinguish "no entry" from "entry whose
# value happens to be None".  Public callers should never see this
# object; the fast-path APIs translate it back to ``None`` when desired.
_MISSING: object = object()


class TTLCache:
    """Thread-safe key-value store with per-entry TTL expiry and LRU cap.

    Usage::

        cache = TTLCache(default_ttl=300)
        cache.set("key", value)
        hit = cache.get("key")  # returns None when expired

        # Double-check locking pattern:
        result = cache.get_or_compute("key", expensive_fn)

    **Size bound:** By default the cache evicts the least-recently-used
    entry when it grows beyond ``DEFAULT_MAX_SIZE``. Pass ``max_size=None``
    only for known-bounded keysets that intentionally need no cap.

    **None values:** ``get()`` still returns ``None`` on a miss,
    but ``get_or_compute()`` correctly caches a computed ``None`` and
    does not recompute it on subsequent hits.  Internally an
    ``_MISSING`` sentinel separates the two states.
    """

    def __init__(
        self,
        default_ttl: int = 300,
        *,
        max_size: int | None = DEFAULT_MAX_SIZE,
    ) -> None:
        self.default_ttl = default_ttl
        self.max_size = max_size
        self._lock = threading.Lock()
        # OrderedDict preserves insertion order; ``move_to_end`` is O(1)
        # and makes LRU eviction cheap.
        self._store: OrderedDict[str, tuple[float, object]] = OrderedDict()

    def _get_unlocked(self, key: str) -> object:
        """Return the cached value, or ``_MISSING`` when absent/expired.

        Caller must hold ``_lock``.
        """
        entry = self._store.get(key)
        if entry is None:
            return _MISSING
        expires_at, value = entry
        if time.monotonic() > expires_at:
            # Lazy expiry: drop the entry so ``__contains__`` stays honest.
            del self._store[key]
            return _MISSING
        # LRU bookkeeping - touching a key keeps it warm.
        self._store.move_to_end(key)
        return value

    def _store_unlocked(self, key: str, value: object, ttl: int | None) -> None:
        """Insert/replace *key* with the given TTL; evict if over capacity.

        Caller must hold ``_lock``.
        """
        self._store[key] = (time.monotonic() + (ttl or self.default_ttl), value)
        self._store.move_to_end(key)
        if self.max_size is not None and len(self._store) > self.max_size:
            # popitem(last=False) removes the LRU (oldest) entry.
            self._store.popitem(last=False)

    def get(self, key: str) -> object | None:
        """Return cached value if still valid, else ``None``.

        Note: this API cannot distinguish "cached None" from "cache miss".
        Prefer :meth:`get_or_compute` when the value can legitimately be
        ``None`` - it uses an internal sentinel to avoid infinite
        recomputation.
        """
        with self._lock:
            hit = self._get_unlocked(key)
            if hit is _MISSING:
                return None
            return hit

    def get_or_compute(self, key: str, compute: Callable[[], T], ttl: int | None = None) -> T:
        """Double-check locking: return cached value or compute and store it.

        Fast path (no lock): returns cached value if valid.
        Slow path (lock): re-checks, then calls *compute()* and caches the result.

        Correctly caches ``None`` results - a cached ``None`` is NOT
        recomputed on subsequent calls within the TTL window.
        """
        with self._lock:
            hit = self._get_unlocked(key)
            if hit is not _MISSING:
                return hit  # type: ignore[return-value]

        # Slow path - compute outside the lock, then re-check under it.
        value = compute()
        with self._lock:
            hit = self._get_unlocked(key)
            if hit is not _MISSING:
                return hit  # type: ignore[return-value]
            self._store_unlocked(key, value, ttl)
            return value

    def set(self, key: str, value: object, ttl: int | None = None) -> None:
        """Store a value with a TTL (defaults to ``default_ttl``)."""
        with self._lock:
            self._store_unlocked(key, value, ttl)

    def delete(self, key: str) -> None:
        """Remove a single entry by key (no-op if missing or expired)."""
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        """Remove all entries."""
        with self._lock:
            self._store.clear()


def canonicalize_key(*parts: object) -> str:
    """Build a deterministic cache key from heterogeneous arguments.

    Collapses dicts / nested containers into a canonical JSON shape so
    that semantically-equal keys (same dict, different Python insertion
    order) produce the same string.

    Usage::

        key = canonicalize_key("user_scores", user_id, {"filters": fs})
        cache.get_or_compute(key, compute)

    Non-JSON-serialisable objects fall back to ``repr(obj)`` - good
    enough for local cache identity but never interchange.
    """
    import json

    def _default(obj: object) -> str:
        return repr(obj)

    payload = [
        json.dumps(part, sort_keys=True, default=_default, separators=(",", ":")) for part in parts
    ]
    return "|".join(payload)
