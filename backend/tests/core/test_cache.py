"""Tests for core.cache — TTL cache with sentinel, LRU, and key canonicalizer."""

import time

import pytest

from core.cache import TTLCache, canonicalize_key


class TestTTLCacheNoneSentinel:
    """P4: get_or_compute must cache None values, not treat them as miss."""

    def test_get_or_compute_caches_none(self):
        cache = TTLCache(default_ttl=60)
        call_count = 0

        def compute():
            nonlocal call_count
            call_count += 1
            return None

        # First call computes and caches None.
        assert cache.get_or_compute("k", compute) is None
        assert call_count == 1

        # Second call within TTL must NOT recompute (previously did).
        assert cache.get_or_compute("k", compute) is None
        assert call_count == 1

    def test_get_or_compute_caches_non_none_values(self):
        cache = TTLCache(default_ttl=60)
        call_count = 0

        def compute():
            nonlocal call_count
            call_count += 1
            return {"value": 42}

        result = cache.get_or_compute("k", compute)
        assert result == {"value": 42}
        # Second call is a cache hit.
        assert cache.get_or_compute("k", compute) == {"value": 42}
        assert call_count == 1

    def test_get_returns_none_for_missing_key(self):
        """Public get() API still maps missing keys to None (no change)."""
        cache = TTLCache(default_ttl=60)
        assert cache.get("missing") is None

    def test_get_returns_cached_none_same_as_missing(self):
        """get() cannot distinguish cached None from miss — documented limitation."""
        cache = TTLCache(default_ttl=60)
        cache.set("k", None)
        # get() cannot tell the difference; callers who need the distinction
        # should use get_or_compute.
        assert cache.get("k") is None

    def test_expired_entries_treated_as_miss(self):
        cache = TTLCache(default_ttl=60)
        cache.set("k", "value", ttl=1)
        # Force expiry by rewinding time.
        cache._store["k"] = (time.monotonic() - 1, "value")

        calls = []

        def compute():
            calls.append(1)
            return "new"

        assert cache.get_or_compute("k", compute) == "new"
        assert len(calls) == 1


class TestTTLCacheMaxSize:
    """P5: LRU eviction when max_size is set."""

    def test_evicts_lru_when_over_capacity(self):
        cache = TTLCache(default_ttl=60, max_size=2)
        cache.set("a", 1)
        cache.set("b", 2)
        cache.set("c", 3)  # Triggers eviction of "a".

        assert cache.get("a") is None
        assert cache.get("b") == 2
        assert cache.get("c") == 3

    def test_access_resets_lru_order(self):
        cache = TTLCache(default_ttl=60, max_size=2)
        cache.set("a", 1)
        cache.set("b", 2)
        # Touch "a" so "b" becomes the LRU.
        assert cache.get("a") == 1
        cache.set("c", 3)  # Evicts "b".

        assert cache.get("a") == 1
        assert cache.get("b") is None
        assert cache.get("c") == 3

    def test_get_or_compute_respects_max_size(self):
        cache = TTLCache(default_ttl=60, max_size=2)
        cache.get_or_compute("a", lambda: 1)
        cache.get_or_compute("b", lambda: 2)
        cache.get_or_compute("c", lambda: 3)
        assert cache.get("a") is None  # Evicted.

    def test_unbounded_when_max_size_none(self):
        cache = TTLCache(default_ttl=60)  # default max_size=None
        for i in range(1000):
            cache.set(str(i), i)
        # No eviction; all 1000 keys present.
        assert cache.get("0") == 0
        assert cache.get("999") == 999


class TestCanonicalizeKey:
    """P16: deterministic cache keys for dict/nested args."""

    def test_dict_order_independence(self):
        k1 = canonicalize_key("user", {"a": 1, "b": 2})
        k2 = canonicalize_key("user", {"b": 2, "a": 1})
        assert k1 == k2

    def test_different_values_different_keys(self):
        k1 = canonicalize_key("user", {"a": 1})
        k2 = canonicalize_key("user", {"a": 2})
        assert k1 != k2

    def test_string_args(self):
        assert canonicalize_key("foo", "bar") == canonicalize_key("foo", "bar")
        assert canonicalize_key("foo", "bar") != canonicalize_key("bar", "foo")

    def test_nested_dicts(self):
        k1 = canonicalize_key("outer", {"nested": {"x": 1, "y": 2}})
        k2 = canonicalize_key("outer", {"nested": {"y": 2, "x": 1}})
        assert k1 == k2
