"""School timezone, alias, and semester date constants.

Waterloo is the only school with explicit special-case constants. All other
schools fall back to neutral defaults in the shared school-context helpers.
"""

FALLBACK_TIMEZONES: dict[str, str] = {
    "university of waterloo": "America/Toronto",
}

FALLBACK_ALIASES: dict[str, str] = {
    "uw": "university of waterloo",
    "u of w": "university of waterloo",
    "uwaterloo": "university of waterloo",
    "waterloo": "university of waterloo",
}

FALLBACK_SEMESTER_ENDS: dict[str, tuple[str, str, str]] = {
    "university of waterloo": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
}

# These are dynamically updated from the schools table in Supabase.
SCHOOL_TIMEZONES: dict[str, str] = dict(FALLBACK_TIMEZONES)
SCHOOL_ALIASES: dict[str, str] = dict(FALLBACK_ALIASES)
SCHOOL_SEMESTER_ENDS: dict[str, tuple[str, str, str]] = dict(FALLBACK_SEMESTER_ENDS)
