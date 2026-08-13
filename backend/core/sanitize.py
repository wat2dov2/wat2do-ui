"""Input sanitization for PostgREST filter strings.

PostgREST filter syntax uses commas (condition separator), periods
(column.operator), and parentheses (nested expressions) as control
characters.  User input interpolated into ``.or_()``, ``.filter()``,
or ``.ilike()`` calls must be stripped of these characters to prevent
filter injection (e.g., enumerating arbitrary columns).

The ``sanitize_postgrest_value`` function below keeps only safe characters
and collapses any resulting extra whitespace.
"""

import json
import re
from datetime import datetime, timezone

# Allow: word characters (letters, digits, underscore), spaces, hyphens,
# apostrophes, and the percent sign (used as the ILIKE wildcard wrapper).
_SAFE_PATTERN = re.compile(r"[^\w\s\-'%]", re.UNICODE)

# Collapse multiple spaces into one.
_MULTI_SPACE = re.compile(r"\s{2,}")

# Instagram captions occasionally arrive with JSON string escapes still
# serialized as text. Match only the sequences observed at that ingestion
# boundary: line breaks and Unicode code points, including surrogate pairs.
_JSON_TEXT_ESCAPE = re.compile(
    r"\\r\\n|\\n|"
    r"\\u[dD][89aAbB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|"
    r"\\u[0-9a-fA-F]{4}"
)


def sanitize_postgrest_value(value: str) -> str:
    """Strip PostgREST-special and other unsafe characters from *value*.

    Keeps: alphanumeric (any script), spaces, hyphens, apostrophes, percent.
    Removes: commas, periods, parentheses, brackets, quotes, backslashes,
    semicolons, and everything else not in the safe set.

    Returns the cleaned string with leading/trailing whitespace trimmed
    and internal runs of whitespace collapsed to a single space.
    """
    cleaned = _SAFE_PATTERN.sub("", value)
    cleaned = _MULTI_SPACE.sub(" ", cleaned)
    return cleaned.strip()


def remove_surrogates(text: str | None) -> str | None:
    """Remove lone surrogate characters that cause utf-8 encoding errors."""
    if not isinstance(text, str):
        return text
    return text.encode("utf-8", "ignore").decode("utf-8")


def normalize_scraped_text(text: str | None) -> str | None:
    """Decode serialized newlines and Unicode escapes in scraped social text.

    The replacement is intentionally narrower than ``unicode_escape`` so
    already-correct Unicode and unrelated backslashes remain unchanged.
    Invalid lone surrogate escapes are preserved instead of introducing a
    string that cannot be encoded as UTF-8.
    """
    if not isinstance(text, str):
        return text

    def decode_match(match: re.Match[str]) -> str:
        escaped = match.group(0)
        if escaped == r"\r\n":
            return "\n"
        try:
            decoded = json.loads(f'"{escaped}"')
        except json.JSONDecodeError:
            return escaped
        if any(0xD800 <= ord(character) <= 0xDFFF for character in decoded):
            return escaped
        return decoded

    return remove_surrogates(_JSON_TEXT_ESCAPE.sub(decode_match, text))


def parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse ISO 8601 strings, sometimes with trailing Z, and ensure UTC timezone."""
    if not isinstance(value, str) or not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
