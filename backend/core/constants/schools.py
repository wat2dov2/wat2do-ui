"""School timezone, alias, and semester date constants.

Waterloo is the only school with explicit special-case constants. All other
schools fall back to neutral defaults in the shared school-context helpers.
"""

# Keys are canonical school names from core.allowed_emails values, lowercased.
SCHOOL_TIMEZONES: dict[str, str] = {
    "university of waterloo": "America/Toronto",
}

SCHOOL_ALIASES: dict[str, str] = {
    "uw": "university of waterloo",
    "u of w": "university of waterloo",
    "uwaterloo": "university of waterloo",
    "waterloo": "university of waterloo",
}

# Fall, Winter/Spring, Summer end times in UTC, format YYYYMMDDTHHMMSSZ.
# Only Waterloo has explicit semester anchors; other schools return None.
SCHOOL_SEMESTER_ENDS: dict[str, tuple[str, str, str]] = {
    "university of waterloo": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
}
