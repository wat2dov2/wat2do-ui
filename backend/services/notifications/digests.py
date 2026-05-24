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
from core.tables import EVENT_DATES, EVENTS, NOTIFICATIONS_LOG
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
from services.notifications.schedule import ensure_aware_utc
from services.school_context import resolve_user_timezone, school_for_user

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
        tz=resolve_user_timezone(user),
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

    tz = resolve_user_timezone(user)
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

    now_utc = ensure_aware_utc(now_utc)
    tz = resolve_user_timezone(user)
    local_now = now_utc.astimezone(tz)
    previous_sent_at = _last_successful_send_at(user_id, NOTIFICATION_TYPE_DAILY_NEW_EVENTS)
    start_utc = previous_sent_at or (now_utc - timedelta(days=1))
    school = school_for_user(user)
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
                    tz=tz,
                    window_start=start_utc,
                    window_end=now_utc,
                ),
                body_text=_render_daily_new_events_text(
                    subject=subject,
                    events=events,
                    school=school_label,
                    tz=tz,
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
    events_q = (
        get_sb()
        .table(EVENTS)
        .select("id,title,location,status,school")
        .eq("status", EVENT_STATUS_ACTIVE)
    )
    if school:
        events_q = events_q.eq("school", school)

    event_rows = events_q.execute().data or []
    events_by_id = {row["id"]: row for row in event_rows if row.get("id") is not None}
    if not events_by_id:
        return []

    q = (
        get_sb()
        .table(EVENT_DATES)
        .select("event_id,dtstart_utc")
        .in_("event_id", list(events_by_id))
        .gte("dtstart_utc", start_utc.isoformat())
        .lte("dtstart_utc", end_utc.isoformat())
        .order("dtstart_utc")
    )
    rows = q.execute().data or []
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in rows:
        eid = row.get("event_id")
        if eid in seen:
            continue
        event = events_by_id.get(eid)
        if not event:
            continue
        seen.add(eid)
        deduped.append({**event, "dtstart_utc": row.get("dtstart_utc")})
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
        return ensure_aware_utc(sent_at)
    try:
        return ensure_aware_utc(datetime.fromisoformat(str(sent_at).replace("Z", "+00:00")))
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
        .table(EVENTS)
        .select(
            "id,title,location,source_image_url,category,"
            "organization,display_handle,school,added_at,status"
        )
        .eq("status", EVENT_STATUS_ACTIVE)
        .gt("added_at", ensure_aware_utc(start_utc).isoformat())
        .lte("added_at", ensure_aware_utc(end_utc).isoformat())
        .order("added_at", desc=True)
    )
    if school:
        q = q.eq("school", school)
    event_rows = q.execute().data or []
    event_ids = [row["id"] for row in event_rows if row.get("id") is not None]
    if not event_ids:
        return []

    occurrence_rows = (
        get_sb()
        .table(EVENT_DATES)
        .select("event_id,dtstart_utc")
        .in_("event_id", event_ids)
        .order("dtstart_utc")
        .execute()
        .data
        or []
    )
    first_date_by_event: dict[int, str | None] = {}
    for occurrence in occurrence_rows:
        event_id = occurrence.get("event_id")
        if event_id not in first_date_by_event:
            first_date_by_event[event_id] = occurrence.get("dtstart_utc")

    return [{**row, "dtstart_utc": first_date_by_event.get(row.get("id"))} for row in event_rows]
