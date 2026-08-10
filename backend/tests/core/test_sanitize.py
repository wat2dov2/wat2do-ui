"""Tests for core.sanitize — PostgREST filter injection prevention."""

import pytest

from core.sanitize import normalize_scraped_text, sanitize_postgrest_value


class TestSanitizePostgrestValue:
    """Verify that dangerous PostgREST control characters are stripped."""

    # -- Safe inputs pass through unchanged --------------------------------

    def test_plain_text_unchanged(self):
        assert sanitize_postgrest_value("pizza night") == "pizza night"

    def test_hyphenated_name(self):
        assert sanitize_postgrest_value("end-of-term") == "end-of-term"

    def test_apostrophe_preserved(self):
        assert sanitize_postgrest_value("dean's list") == "dean's list"

    def test_unicode_preserved(self):
        assert sanitize_postgrest_value("cafe") == "cafe"

    def test_digits_preserved(self):
        assert sanitize_postgrest_value("Room 101") == "Room 101"

    def test_percent_wildcard_preserved(self):
        """The ILIKE wildcard wrapper is safe to keep."""
        assert sanitize_postgrest_value("%term%") == "%term%"

    # -- Dangerous PostgREST characters are stripped -----------------------

    def test_comma_stripped(self):
        """Commas separate filter conditions in PostgREST .or_() syntax."""
        assert (
            sanitize_postgrest_value("a]],secret_col.eq.1,title.ilike.[%b")
            == "asecret_coleq1titleilike%b"
        )

    def test_period_stripped(self):
        """Periods separate column.operator in PostgREST filter syntax."""
        result = sanitize_postgrest_value("col.ilike.val")
        assert "." not in result

    def test_parentheses_stripped(self):
        """Parentheses create nested expressions in PostgREST."""
        assert sanitize_postgrest_value("a(b)c") == "abc"

    def test_comma_injection_attack(self):
        """Classic injection: inject an extra filter condition via comma."""
        attack = "test,secret_column.eq.admin"
        result = sanitize_postgrest_value(attack)
        assert "," not in result
        assert "." not in result

    def test_nested_expression_attack(self):
        """Nested expression injection via parentheses."""
        attack = "test),secret_column.eq.1,title.ilike.(%test"
        result = sanitize_postgrest_value(attack)
        assert "(" not in result
        assert ")" not in result
        assert "," not in result
        assert "." not in result

    # -- Edge cases --------------------------------------------------------

    def test_empty_string(self):
        assert sanitize_postgrest_value("") == ""

    def test_only_dangerous_chars(self):
        """Input with nothing but special chars becomes empty."""
        assert sanitize_postgrest_value(".,()[]{}") == ""

    def test_whitespace_collapsed(self):
        assert sanitize_postgrest_value("  too   many   spaces  ") == "too many spaces"

    def test_semicolon_stripped(self):
        assert sanitize_postgrest_value("a;b") == "ab"

    def test_backslash_stripped(self):
        assert sanitize_postgrest_value("a\\b") == "ab"

    def test_quotes_stripped(self):
        assert sanitize_postgrest_value('a"b') == "ab"
        assert sanitize_postgrest_value("a`b") == "ab"


class TestNormalizeScrapedText:
    def test_decodes_json_escaped_emoji_and_newlines(self):
        escaped = r"\ud83d\udcca Having trouble?\n\n\ud83c\udf55 Pizza is provided!"

        assert normalize_scraped_text(escaped) == "📊 Having trouble?\n\n🍕 Pizza is provided!"

    def test_decodes_bmp_unicode_escapes(self):
        assert normalize_scraped_text(r"Caf\u00e9 \u2728") == "Café ✨"

    def test_preserves_existing_unicode_and_unrelated_backslashes(self):
        text = "📊 Café C:\\events\\poster"

        assert normalize_scraped_text(text) == text

    def test_preserves_invalid_lone_surrogate_escape(self):
        assert normalize_scraped_text(r"broken \ud83d caption") == r"broken \ud83d caption"
