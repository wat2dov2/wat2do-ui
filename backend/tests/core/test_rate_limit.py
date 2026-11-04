"""Tests for core.rate_limit: limiter correctness."""

import pytest

from core.exceptions import RateLimitExceeded
from core.rate_limit import RateLimiter


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
