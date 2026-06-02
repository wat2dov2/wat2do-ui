"""Shared school context helpers for time-sensitive backend behavior.

Calendar feeds, notification scheduling, and the wat2do scraper all need the
same school canonicalization and timezone rules. Keep the domain behavior here
so feature services do not each grow their own variant.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from core.constants import SCHOOL_ALIASES, SCHOOL_SEMESTER_ENDS, SCHOOL_TIMEZONES

log = logging.getLogger(__name__)

_UTC_TZID = "UTC"


def canonical_school_key(school: str | None) -> str:
    """Return the normalized key used by school constants."""
    raw = (school or "").strip().lower()
    return SCHOOL_ALIASES.get(raw, raw)


def resolve_school_timezone(school: str | None) -> str:
    """Return the IANA timezone for a school, falling back to UTC.

    Waterloo is the only school with an explicit timezone mapping. All other
    schools share the neutral UTC fallback.
    """
    canonical = canonical_school_key(school)
    if not canonical:
        return _UTC_TZID

    tz = SCHOOL_TIMEZONES.get(canonical)
    if tz is None:
        log.warning(
            "Unknown school %r (canonical %r) in school timezone lookup; falling back to UTC",
            school,
            canonical,
        )
        return _UTC_TZID
    return tz


def school_for_user(user: dict[str, Any]) -> str | None:
    """Resolve a user's school, reading exclusively from the stored school field."""
    explicit = (user.get("school") or "").strip()
    return explicit or None


def resolve_user_timezone(user: dict[str, Any]) -> ZoneInfo:
    """Return a user's school timezone as ``ZoneInfo``, falling back to UTC."""
    school = school_for_user(user)
    canonical = canonical_school_key(school)
    tz_name = SCHOOL_TIMEZONES.get(canonical)
    if not tz_name:
        log.warning(
            "unresolved school=%r for user=%s; falling back to UTC",
            school,
            user.get("id"),
        )
        return ZoneInfo(_UTC_TZID)
    return ZoneInfo(tz_name)


def current_semester_end(school: str | None, *, now: datetime | None = None) -> str | None:
    """Return the UTC end timestamp of the semester containing ``now``.

    Format is ``YYYYMMDDTHHMMSSZ``. Unknown schools return ``None`` so callers
    can omit school-specific prompt context instead of guessing. Only Waterloo
    has an explicit semester schedule; other schools use the neutral
    ``None`` fallback.
    """
    canonical = canonical_school_key(school)
    if not canonical:
        return None

    ends = SCHOOL_SEMESTER_ENDS.get(canonical)
    if ends is None:
        return None

    month = (now or datetime.now(timezone.utc)).month
    if 1 <= month <= 4:
        return ends[1]
    if 5 <= month <= 8:
        return ends[2]
    return ends[0]


__all__ = [
    "canonical_school_key",
    "current_semester_end",
    "resolve_school_timezone",
    "resolve_user_timezone",
    "school_for_user",
]
