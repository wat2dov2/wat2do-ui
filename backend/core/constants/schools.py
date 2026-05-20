"""School timezone, alias, and semester date constants."""

# Keys are canonical school names from core.allowed_emails values, lowercased.
SCHOOL_TIMEZONES: dict[str, str] = {
    "university of waterloo": "America/Toronto",
    "wilfrid laurier university": "America/Toronto",
    "university of guelph": "America/Toronto",
    "conestoga college": "America/Toronto",
    "university of pennsylvania": "America/New_York",
    "new york university": "America/New_York",
    "columbia university": "America/New_York",
    "massachusetts institute of technology": "America/New_York",
}

SCHOOL_ALIASES: dict[str, str] = {
    "uw": "university of waterloo",
    "u of w": "university of waterloo",
    "uwaterloo": "university of waterloo",
    "waterloo": "university of waterloo",
    "laurier": "wilfrid laurier university",
    "wlu": "wilfrid laurier university",
    "guelph": "university of guelph",
    "conestoga": "conestoga college",
    "upenn": "university of pennsylvania",
    "penn": "university of pennsylvania",
    "nyu": "new york university",
    "columbia": "columbia university",
    "mit": "massachusetts institute of technology",
}

# Fall, Winter/Spring, Summer end times in UTC, format YYYYMMDDTHHMMSSZ.
SCHOOL_SEMESTER_ENDS: dict[str, tuple[str, str, str]] = {
    "university of waterloo": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
    "wilfrid laurier university": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
    "university of guelph": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
    "conestoga college": (
        "20251231T235959Z",
        "20260430T235959Z",
        "20260831T235959Z",
    ),
    "university of pennsylvania": (
        "20251231T235959Z",
        "20260531T235959Z",
        "20260831T235959Z",
    ),
    "new york university": (
        "20251231T235959Z",
        "20260531T235959Z",
        "20260831T235959Z",
    ),
    "columbia university": (
        "20251231T235959Z",
        "20260531T235959Z",
        "20260831T235959Z",
    ),
    "massachusetts institute of technology": (
        "20251231T235959Z",
        "20260531T235959Z",
        "20260831T235959Z",
    ),
}
