"""Input sanitization for PostgREST filter strings.

PostgREST filter syntax uses commas (condition separator), periods
(column.operator), and parentheses (nested expressions) as control
characters.  User input interpolated into ``.or_()``, ``.filter()``,
or ``.ilike()`` calls must be stripped of these characters to prevent
filter injection (e.g., enumerating arbitrary columns).

The ``sanitize_postgrest_value`` function below keeps only safe characters
and collapses any resulting extra whitespace.
"""

import re

# Allow: word characters (letters, digits, underscore), spaces, hyphens,
# apostrophes, and the percent sign (used as the ILIKE wildcard wrapper).
_SAFE_PATTERN = re.compile(r"[^\w\s\-'%]", re.UNICODE)

# Collapse multiple spaces into one.
_MULTI_SPACE = re.compile(r"\s{2,}")


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
