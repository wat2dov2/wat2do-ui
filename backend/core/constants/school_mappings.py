"""Static school catalog.

``SCHOOLS`` maps slug -> metadata.  ``RECIPIENT_ID_TO_SCHOOL_SLUG`` maps
Instagram inbox profile IDs -> slug for the scrape webhook.

Email domains stay in Supabase (``core.allowed_emails``).
"""

from __future__ import annotations

from typing import Any

# slug -> {display_name, timezone, semester_ends?}
SCHOOLS: dict[str, dict[str, Any]] = {
    "uwaterloo": {
        "display_name": "University of Waterloo",
        "timezone": "America/Toronto",
        "semester_ends": ("20251231T235959Z", "20260430T235959Z", "20260831T235959Z"),
    },
    "utoronto": {
        "display_name": "University of Toronto - St. George",
        "timezone": "America/Toronto",
    },
    "utsc": {
        "display_name": "University of Toronto - Scarborough",
        "timezone": "America/Toronto",
    },
    "utm": {
        "display_name": "University of Toronto Mississauga",
        "timezone": "America/Toronto",
    },
    "mcgill": {
        "display_name": "McGill University",
        "timezone": "America/Toronto",
    },
    "mcmaster": {
        "display_name": "McMaster University",
        "timezone": "America/Toronto",
    },
    "western": {
        "display_name": "Western University",
        "timezone": "America/Toronto",
    },
    "queens": {
        "display_name": "Queen's University",
        "timezone": "America/Toronto",
    },
    "carleton": {
        "display_name": "Carleton University",
        "timezone": "America/Toronto",
    },
    "brock": {
        "display_name": "Brock University",
        "timezone": "America/Toronto",
    },
    "wlu": {
        "display_name": "Wilfrid Laurier University",
        "timezone": "America/Toronto",
    },
    "york": {
        "display_name": "York University",
        "timezone": "America/Toronto",
    },
    "tmu": {
        "display_name": "Toronto Metropolitan University",
        "timezone": "America/Toronto",
    },
    "uottawa": {
        "display_name": "University of Ottawa",
        "timezone": "America/Toronto",
    },
    "ocad": {
        "display_name": "OCAD University",
        "timezone": "America/Toronto",
    },
    "cornell": {
        "display_name": "Cornell University",
        "timezone": "America/New_York",
    },
    "nyu": {
        "display_name": "New York University",
        "timezone": "America/New_York",
    },
    "upenn": {
        "display_name": "University of Pennsylvania",
        "timezone": "America/New_York",
    },
    "columbia": {
        "display_name": "Columbia University",
        "timezone": "America/New_York",
    },
    "mit": {
        "display_name": "Massachusetts Institute of Technology",
        "timezone": "America/New_York",
    },
    "ubc": {
        "display_name": "University of British Columbia",
        "timezone": "America/Vancouver",
    },
    "berkeley": {
        "display_name": "University of California, Berkeley",
        "timezone": "America/Los_Angeles",
    },
}

RECIPIENT_ID_TO_SCHOOL_SLUG: dict[str, str] = {
    "76214170483": "uwaterloo",
    "78383689040": "utm",
}


def normalize_school_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def school_display_name(slug: str | None) -> str:
    normalized = normalize_school_slug(slug)
    school = SCHOOLS.get(normalized)
    if school:
        return school["display_name"]
    return normalized


def school_timezone(slug: str | None) -> str | None:
    school = SCHOOLS.get(normalize_school_slug(slug))
    return school["timezone"] if school else None


def school_semester_ends(slug: str | None) -> tuple[str, str, str] | None:
    school = SCHOOLS.get(normalize_school_slug(slug))
    if not school:
        return None
    return school.get("semester_ends")
