"""Tests for core.rate_limit — per-endpoint buckets and limiter correctness."""

import pytest

from core.exceptions import RateLimitExceeded
from core.rate_limit import (
    RateLimiter,
    forgot_password_rate_limiter,
    login_rate_limiter,
    reset_password_rate_limiter,
    signup_rate_limiter,
)


class TestRateLimiterBasic:
    def test_allows_under_limit(self):
        lim = RateLimiter(max_requests=3, window_seconds=60)
        lim.check("ip1")
        lim.check("ip1")
        lim.check("ip1")

    def test_raises_when_exceeded(self):
        lim = RateLimiter(max_requests=2, window_seconds=60)
        lim.check("ip1")
        lim.check("ip1")
        with pytest.raises(RateLimitExceeded):
            lim.check("ip1")

    def test_independent_keys(self):
        lim = RateLimiter(max_requests=1, window_seconds=60)
        lim.check("ip1")
        # "ip2" has its own bucket.
        lim.check("ip2")


class TestPerEndpointBuckets:
    """P3: separate limiter instances per endpoint prevent cross-bucket blocking."""

    def test_login_and_signup_are_distinct_instances(self):
        """Most important guarantee: not the same object."""
        assert login_rate_limiter is not signup_rate_limiter

    def test_forgot_and_reset_password_are_distinct(self):
        assert forgot_password_rate_limiter is not reset_password_rate_limiter

    def test_signup_burst_does_not_block_login(self):
        # Exhaust signup bucket for a fake IP.
        key = "test-ip-P3"
        for _ in range(signup_rate_limiter.max_requests):
            signup_rate_limiter.check(key)
        with pytest.raises(RateLimitExceeded):
            signup_rate_limiter.check(key)

        # Login bucket for the same key is still untouched — legitimate
        # users at the shared IP must still be able to log in.
        login_rate_limiter.check(key)

        # Cleanup so later tests do not inherit state.
        signup_rate_limiter._requests.pop(key, None)
        login_rate_limiter._requests.pop(key, None)
