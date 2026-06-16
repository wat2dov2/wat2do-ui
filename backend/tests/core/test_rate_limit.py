"""Tests for core.rate_limit — per-endpoint buckets and limiter correctness."""

import pytest

from core.exceptions import RateLimitExceeded
from core.rate_limit import (
    RateLimiter,
    send_otp_rate_limiter,
    verify_otp_rate_limiter,
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

    def test_send_and_verify_are_distinct_instances(self):
        """Most important guarantee: not the same object."""
        assert send_otp_rate_limiter is not verify_otp_rate_limiter

    def test_send_burst_does_not_block_verify(self):
        # Exhaust send bucket for a fake IP.
        key = "test-ip-P3"
        for _ in range(send_otp_rate_limiter.max_requests):
            send_otp_rate_limiter.check(key)
        with pytest.raises(RateLimitExceeded):
            send_otp_rate_limiter.check(key)

        # Verify bucket for the same key is still untouched — legitimate
        # users at the shared IP must still be able to verify.
        verify_otp_rate_limiter.check(key)

        # Cleanup so later tests do not inherit state.
        send_otp_rate_limiter._requests.pop(key, None)
        verify_otp_rate_limiter._requests.pop(key, None)
