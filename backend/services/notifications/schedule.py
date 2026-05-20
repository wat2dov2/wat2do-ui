"""Notification local-time scheduling and school timezone resolution."""

import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from core.allowed_emails import get_school_for_email
from core.constants import SCHOOL_ALIASES, SCHOOL_TIMEZONES

log = logging.getLogger(__name__)

# Cron-firing constants — hour-of-day / day-of-week in the user's local
# timezone. The hourly cron iterates users, converts UTC → local per
# user's school tz, and fires when the local clock matches. Change
# these once to move the send time for every school.
DAILY_NEW_EVENTS_HOUR = 10
DAILY_NEW_EVENTS_MINUTE = 30
MORNING_DIGEST_HOUR = 9
WEEKLY_DIGEST_HOUR = 18
WEEKLY_DIGEST_WEEKDAY = 6  # Python weekday(): Mon=0 ... Sun=6


def _ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _canonical_school_key(school: str | None) -> str:
    raw = (school or "").strip().lower()
    return SCHOOL_ALIASES.get(raw, raw)


def _school_for_user(user: dict) -> str | None:
    email_school = get_school_for_email(user.get("email") or "")
    if email_school:
        return email_school
    explicit = (user.get("school") or "").strip()
    return explicit or None


def _user_tz(user: dict) -> ZoneInfo:
    school = _school_for_user(user)
    canonical = _canonical_school_key(school)
    tz_name = SCHOOL_TIMEZONES.get(canonical)
    if not tz_name:
        log.warning(
            "unresolved school=%r for user=%s; falling back to UTC",
            school,
            user.get("id"),
        )
        return ZoneInfo("UTC")
    return ZoneInfo(tz_name)


def is_daily_new_events_time(user: dict, now_utc: datetime) -> datetime | None:
    """Return the local send timestamp if ``now_utc`` is 10:30am-local."""
    local = _ensure_aware_utc(now_utc).astimezone(_user_tz(user))
    if local.hour == DAILY_NEW_EVENTS_HOUR and local.minute == DAILY_NEW_EVENTS_MINUTE:
        return local
    return None


def is_morning_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return the user's local date if ``now_utc`` is 9am-local, else None.

    Dispatcher helper for the hourly cron: lets the cron stay school-
    agnostic and makes the decision testable (inject a fixed ``now_utc``).
    """
    local = now_utc.astimezone(_user_tz(user))
    if local.hour == MORNING_DIGEST_HOUR:
        return local.date()
    return None


def is_weekly_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return Monday-of-preview-week if ``now_utc`` is Sunday 6pm-local.

    Sunday evening previews the UPCOMING week (tomorrow onwards), so the
    returned date is ``local.date() + 1 day`` — always a Monday.
    """
    local = now_utc.astimezone(_user_tz(user))
    if local.weekday() == WEEKLY_DIGEST_WEEKDAY and local.hour == WEEKLY_DIGEST_HOUR:
        return local.date() + timedelta(days=1)
    return None
