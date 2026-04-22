"""Tests for core.retry — jitter + retry behaviour."""

from tenacity.wait import wait_exponential_jitter

from core.retry import RETRY_STOP, RETRY_WAIT


def test_retry_wait_has_jitter():
    """P14: wait strategy must be jittered, not plain exponential.

    The thundering-herd class of bug happens when all clients share the
    same deterministic backoff schedule; jitter spreads the retry traffic.
    """
    assert isinstance(RETRY_WAIT, wait_exponential_jitter)


def test_retry_stop_bounded():
    """Retries should not be unbounded — avoid infinite loops on poison requests."""
    # stop_after_attempt exposes max_attempt_number in tenacity >= 8.
    assert RETRY_STOP.max_attempt_number == 3
