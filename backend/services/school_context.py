"""Shared school context helpers for time-sensitive backend behavior.

School slugs are the wire/DB contract.  Metadata lives in
``core.constants.school_mappings``; email domains live in ``core.allowed_emails``.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from core.constants.school_mappings import (
    normalize_school_slug,
    school_display_name,
    school_semester_ends,
    school_timezone,
)

log = logging.getLogger(__name__)

_UTC_TZID = "UTC"


def canonical_school_key(school: str | None) -> str:
    """Return the normalized school slug."""
    return normalize_school_slug(school)


def resolve_school_timezone(school: str | None) -> str:
    """Return the IANA timezone for a school slug, falling back to UTC."""
    slug = canonical_school_key(school)
    if not slug:
        return _UTC_TZID

    tz = school_timezone(slug)
    if tz is None:
        log.warning(
            "Unknown school slug %r in timezone lookup; falling back to UTC",
            school,
        )
        return _UTC_TZID
    return tz


def school_for_user(user: dict[str, Any]) -> str | None:
    """Return the user's stored school slug, if any."""
    explicit = (user.get("school") or "").strip()
    return explicit or None


def resolve_user_timezone(user: dict[str, Any]) -> ZoneInfo:
    """Return a user's school timezone as ``ZoneInfo``, falling back to UTC."""
    school = school_for_user(user)
    tz_name = school_timezone(canonical_school_key(school))
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

    Format is ``YYYYMMDDTHHMMSSZ``. Unknown schools return ``None``.
    """
    slug = canonical_school_key(school)
    if not slug:
        return None

    ends = school_semester_ends(slug)
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
    "school_display_name",
    "school_for_user",
]
