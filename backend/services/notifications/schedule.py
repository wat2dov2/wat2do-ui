"""Notification local-time scheduling."""

from datetime import date, datetime, timedelta, timezone

from services.school_context import resolve_user_timezone

# Cron-firing constants — hour-of-day / day-of-week in the user's local
# timezone. The hourly cron iterates users, converts UTC → local per
# user's school tz, and fires when the local clock matches. Change
# these once to move the send time for every school.
DAILY_NEW_EVENTS_HOUR = 10
DAILY_NEW_EVENTS_MINUTE = 30
MORNING_DIGEST_HOUR = 9
WEEKLY_DIGEST_HOUR = 18
WEEKLY_DIGEST_WEEKDAY = 6  # Python weekday(): Mon=0 ... Sun=6


def ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def is_daily_new_events_time(user: dict, now_utc: datetime) -> datetime | None:
    """Return the local send timestamp if ``now_utc`` is 10:30am-local."""
    local = ensure_aware_utc(now_utc).astimezone(resolve_user_timezone(user))
    if local.hour == DAILY_NEW_EVENTS_HOUR and local.minute == DAILY_NEW_EVENTS_MINUTE:
        return local
    return None


def is_morning_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return the user's local date if ``now_utc`` is 9am-local, else None.

    Dispatcher helper for the hourly cron: lets the cron stay school-
    agnostic and makes the decision testable (inject a fixed ``now_utc``).
    """
    local = ensure_aware_utc(now_utc).astimezone(resolve_user_timezone(user))
    if local.hour == MORNING_DIGEST_HOUR:
        return local.date()
    return None


def is_weekly_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return Monday-of-preview-week if ``now_utc`` is Sunday 6pm-local.

    Sunday evening previews the UPCOMING week (tomorrow onwards), so the
    returned date is ``local.date() + 1 day`` — always a Monday.
    """
    local = ensure_aware_utc(now_utc).astimezone(resolve_user_timezone(user))
    if local.weekday() == WEEKLY_DIGEST_WEEKDAY and local.hour == WEEKLY_DIGEST_HOUR:
        return local.date() + timedelta(days=1)
    return None
