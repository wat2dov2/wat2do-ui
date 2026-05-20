"""Cron-triggered notification digest send flows."""

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from core.constants import (
    EVENT_STATUS_ACTIVE,
    NOTIFICATION_STATUS_SENT,
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
)
from core.database import get_sb
from core.tables import EVENTS_LISTING, NOTIFICATIONS_LOG
from services.email_service import EmailMessage, email_service
from services.notifications.delivery_log import (
    _mark_log_failed,
    _mark_log_sent,
    _try_insert_log_row,
)
from services.notifications.preferences import is_enabled
from services.notifications.rendering import (
    _daily_new_events_subject,
    _digest_subject,
    _render_daily_new_events_html,
    _render_daily_new_events_text,
    _render_digest_html,
    _render_digest_text,
)
from services.notifications.schedule import _ensure_aware_utc, _school_for_user, _user_tz

log = logging.getLogger(__name__)


def send_morning_digest(user: dict, local_date: date) -> bool:
    """Send one user's morning digest for ``local_date``. No-op on skip."""
    user_id = user["id"]
    email = user.get("email")
    if not email:
        return False
    if not is_enabled(user_id, NOTIFICATION_TYPE_MORNING_DIGEST):
        return False

    events = _fetch_events_for_day(
        school=user.get("school"),
        local_date=local_date,
        tz=_user_tz(user),
    )
    if not events:
        log.info(
            "skipped morning_digest user=%s reason=no_events date=%s",
            user_id,
            local_date,
        )
        return False

    return _send_digest(
        user_id=user_id,
        email=email,
        notification_type=NOTIFICATION_TYPE_MORNING_DIGEST,
        target_id=local_date.isoformat(),
        subject=_digest_subject(len(events), "today"),
        events=events,
    )


def send_weekly_digest(user: dict, week_start: date) -> bool:
    """Send one user's weekly digest previewing the week that starts ``week_start``."""
    user_id = user["id"]
    email = user.get("email")
    if not email:
        return False
    if not is_enabled(user_id, NOTIFICATION_TYPE_WEEKLY_DIGEST):
        return False

    tz = _user_tz(user)
    week_end = week_start + timedelta(days=6)
    events = _fetch_events_for_range(
        school=user.get("school"),
        start_date=week_start,
        end_date=week_end,
        tz=tz,
    )
    iso = week_start.isocalendar()
    if not events:
        log.info(
            "skipped weekly_digest user=%s reason=no_events week=%s-W%s",
            user_id,
            iso[0],
            iso[1],
        )
        return False

    return _send_digest(
        user_id=user_id,
        email=email,
        notification_type=NOTIFICATION_TYPE_WEEKLY_DIGEST,
        target_id=f"{iso[0]}-W{iso[1]:02d}",
        subject=_digest_subject(len(events), "this week"),
        events=events,
    )


def send_daily_new_events_digest(user: dict, now_utc: datetime) -> bool:
    """Send one user's opt-in daily digest of newly-added school events."""
    user_id = user["id"]
    email = user.get("email")
    if not email:
        return False
    if not is_enabled(user_id, NOTIFICATION_TYPE_DAILY_NEW_EVENTS):
        return False

    now_utc = _ensure_aware_utc(now_utc)
    local_now = now_utc.astimezone(_user_tz(user))
    previous_sent_at = _last_successful_send_at(user_id, NOTIFICATION_TYPE_DAILY_NEW_EVENTS)
    start_utc = previous_sent_at or (now_utc - timedelta(days=1))
    school = _school_for_user(user)
    events = _fetch_new_events_added_since(
        school=school,
        start_utc=start_utc,
        end_utc=now_utc,
    )
    if not events:
        log.info(
            "skipped daily_new_events user=%s reason=no_new_events window=%s..%s",
            user_id,
            start_utc.isoformat(),
            now_utc.isoformat(),
        )
        return False

    target_id = local_now.date().isoformat()
    row_id = _try_insert_log_row(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
        target_id=target_id,
    )
    if row_id is None:
        return False

    school_label = school or "your school"
    subject = _daily_new_events_subject(len(events), school_label)
    try:
        email_service.send(
            EmailMessage(
                to=email,
                subject=subject,
                body_html=_render_daily_new_events_html(
                    subject=subject,
                    events=events,
                    school=school_label,
                    tz=_user_tz(user),
                    window_start=start_utc,
                    window_end=now_utc,
                ),
                body_text=_render_daily_new_events_text(
                    subject=subject,
                    events=events,
                    school=school_label,
                    tz=_user_tz(user),
                    window_start=start_utc,
                    window_end=now_utc,
                ),
                idempotency_key=(f"{NOTIFICATION_TYPE_DAILY_NEW_EVENTS}:{user_id}:{target_id}"),
            )
        )
    except Exception as e:
        log.warning("daily_new_events send failed user=%s: %s", user_id, e)
        _mark_log_failed(row_id)
        return False
    _mark_log_sent(row_id)
    return True


def _send_digest(
    *,
    user_id: str,
    email: str,
    notification_type: str,
    target_id: str,
    subject: str,
    events: list[dict],
) -> bool:
    row_id = _try_insert_log_row(
        user_id=user_id,
        notification_type=notification_type,
        target_id=target_id,
    )
    if row_id is None:
        return False
    try:
        email_service.send(
            EmailMessage(
                to=email,
                subject=subject,
                body_html=_render_digest_html(subject, events),
                body_text=_render_digest_text(subject, events),
                idempotency_key=f"{notification_type}:{user_id}:{target_id}",
            )
        )
    except Exception as e:
        log.warning(
            "digest send failed user=%s type=%s target=%s: %s",
            user_id,
            notification_type,
            target_id,
            e,
        )
        _mark_log_failed(row_id)
        return False
    _mark_log_sent(row_id)
    return True


def _fetch_events_for_day(*, school: str | None, local_date: date, tz: ZoneInfo) -> list[dict]:
    start_local = datetime.combine(local_date, time.min, tzinfo=tz)
    end_local = datetime.combine(local_date, time.max, tzinfo=tz)
    return _fetch_events_in_utc_range(
        school=school,
        start_utc=start_local.astimezone(timezone.utc),
        end_utc=end_local.astimezone(timezone.utc),
    )


def _fetch_events_for_range(
    *,
    school: str | None,
    start_date: date,
    end_date: date,
    tz: ZoneInfo,
) -> list[dict]:
    start_local = datetime.combine(start_date, time.min, tzinfo=tz)
    end_local = datetime.combine(end_date, time.max, tzinfo=tz)
    return _fetch_events_in_utc_range(
        school=school,
        start_utc=start_local.astimezone(timezone.utc),
        end_utc=end_local.astimezone(timezone.utc),
    )


def _fetch_events_in_utc_range(
    *,
    school: str | None,
    start_utc: datetime,
    end_utc: datetime,
) -> list[dict]:
    """Fetch events with at least one occurrence in [start_utc, end_utc]."""
    q = (
        get_sb()
        .table(EVENTS_LISTING)
        .select("id, title, location, dtstart_utc")
        .eq("status", EVENT_STATUS_ACTIVE)
        .gte("dtstart_utc", start_utc.isoformat())
        .lte("dtstart_utc", end_utc.isoformat())
        .order("dtstart_utc")
    )
    if school:
        q = q.eq("school", school)
    rows = q.execute().data or []
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in rows:
        eid = row.get("id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(row)
    return deduped


def _last_successful_send_at(user_id: str, notification_type: str) -> datetime | None:
    rows = (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .select("sent_at")
        .eq("user_id", user_id)
        .eq("notification_type", notification_type)
        .eq("status", NOTIFICATION_STATUS_SENT)
        .not_.is_("sent_at", "null")
        .order("sent_at", desc=True)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        return None
    sent_at = rows[0].get("sent_at")
    if not sent_at:
        return None
    if isinstance(sent_at, datetime):
        return _ensure_aware_utc(sent_at)
    try:
        return _ensure_aware_utc(datetime.fromisoformat(str(sent_at).replace("Z", "+00:00")))
    except ValueError:
        log.warning(
            "invalid sent_at=%r for user=%s type=%s",
            sent_at,
            user_id,
            notification_type,
        )
        return None


def _fetch_new_events_added_since(
    *,
    school: str | None,
    start_utc: datetime,
    end_utc: datetime,
) -> list[dict]:
    q = (
        get_sb()
        .table(EVENTS_LISTING)
        .select(
            "id,title,location,dtstart_utc,source_image_url,category,"
            "organization,display_handle,school,added_at,status"
        )
        .eq("status", EVENT_STATUS_ACTIVE)
        .gt("added_at", _ensure_aware_utc(start_utc).isoformat())
        .lte("added_at", _ensure_aware_utc(end_utc).isoformat())
        .order("added_at", desc=True)
        .order("dtstart_utc")
    )
    if school:
        q = q.eq("school", school)
    rows = q.execute().data or []
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in rows:
        eid = row.get("id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(row)
    return deduped
