"""Shared school context helpers for time-sensitive backend behavior."""

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from services import school_service

log = logging.getLogger(__name__)

_UTC_TZID = "UTC"


def canonical_school_key(school: str | None) -> str:
    """Return the normalized school slug."""
    return school_service.normalize_school_slug(school)


def resolve_school_timezone(school: str | None) -> str:
    """Return the IANA timezone for a school slug, falling back to UTC."""
    slug = canonical_school_key(school)
    if not slug:
        return _UTC_TZID

    school_record = school_service.get_school(slug)
    if school_record is None:
        log.warning(
            "Unknown school slug %r in timezone lookup; falling back to UTC",
            school,
        )
        return _UTC_TZID
    return school_record.timezone


def school_for_user(user: dict[str, Any]) -> str | None:
    """Return the user's stored school slug, if any."""
    explicit = (user.get("school") or "").strip()
    return explicit or None


def resolve_user_timezone(user: dict[str, Any]) -> ZoneInfo:
    """Return a user's school timezone as ``ZoneInfo``, falling back to UTC."""
    school = school_for_user(user)
    school_record = school_service.get_school(canonical_school_key(school))
    if school_record is None:
        log.warning(
            "unresolved school=%r for user=%s; falling back to UTC",
            school,
            user.get("id"),
        )
        return ZoneInfo(_UTC_TZID)
    return ZoneInfo(school_record.timezone)


def current_semester_end(school: str | None, *, now: datetime | None = None) -> str | None:
    """Return the UTC end timestamp of the semester containing ``now``.

    Format is ``YYYYMMDDTHHMMSSZ``. Unknown schools return ``None``.
    """
    slug = canonical_school_key(school)
    if not slug:
        return None

    school_record = school_service.get_school(slug)
    if school_record is None:
        return None

    if school_record.semester_start is None or school_record.semester_end is None:
        return None

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is not None:
        current = current.astimezone(ZoneInfo(school_record.timezone))
    if not school_record.semester_start <= current.date() <= school_record.semester_end:
        return None
    return f"{school_record.semester_end:%Y%m%d}T235959Z"


__all__ = [
    "canonical_school_key",
    "current_semester_end",
    "resolve_school_timezone",
    "resolve_user_timezone",
    "school_for_user",
]
