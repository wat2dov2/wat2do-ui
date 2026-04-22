"""Tests for core.error_handlers — log sanitization."""

from core.error_handlers import _safe


class TestSafeLogHelper:
    """E21: strip CR/LF so attacker-controlled fields can't forge log lines."""

    def test_passes_plain_strings_through(self):
        assert _safe("hello") == "hello"

    def test_replaces_newline(self):
        assert _safe("victim@x.com\nINFO fake event") == "victim@x.com\\nINFO fake event"

    def test_replaces_carriage_return(self):
        assert _safe("line1\rline2") == "line1\\rline2"

    def test_replaces_both_cr_and_lf(self):
        assert _safe("a\r\nb") == "a\\r\\nb"

    def test_handles_none(self):
        assert _safe(None) == ""

    def test_coerces_non_strings(self):
        assert _safe(42) == "42"

    def test_coerces_exception(self):
        exc = ValueError("bad\nthing")
        # str(exc) → "bad\nthing", then sanitized.
        assert _safe(exc) == "bad\\nthing"
