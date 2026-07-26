"""One-hour reminder delivery for occurrence-aware Going selections."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from core.config import settings
from core.constants import NOTIFICATION_TYPE_EVENT_REMINDER
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_GOING_EVENTS, USERS
from services.email_service import EmailMessage
from services.notifications.delivery_log import claim_delivery, deliver_claimed_email
from services.notifications.preferences import get_enabled_user_ids
from services.notifications.rendering import (
    event_reminder_subject,
    render_event_reminder_html,
    render_event_reminder_text,
)
from services.notifications.unsubscribe import unsubscribe_url
from services.school_context import resolve_user_timezone

log = logging.getLogger(__name__)

_CONTROL = controlbox.event_reminder
_CHUNK_SIZE = 500


def dispatch_event_reminders(now_utc: datetime) -> dict[str, int]:
    """Send each selected occurrence once when it reaches the reminder window."""
    window_start, window_end = _reminder_window(_aware_utc(now_utc))
    due = _load_due_reminders(window_start, window_end)
    if not due:
        return {"due": 0, "prepared": 0, "sent": 0, "failed": 0, "skipped": 0}

    user_ids = list(dict.fromkeys(str(row["user_id"]) for row in due))
    users_by_id = _load_users(user_ids)
    enabled_ids = get_enabled_user_ids(user_ids, NOTIFICATION_TYPE_EVENT_REMINDER)

    prepared = 0
    sent = 0
    failed = 0
    skipped = 0
    for row in due:
        user_id = str(row["user_id"])
        user = users_by_id.get(user_id)
        if not user or not user.get("email") or user_id not in enabled_ids:
            skipped += 1
            continue

        prepared += 1
        delivery_result = _send_event_reminder(user=user, reminder=row)
        if delivery_result is True:
            sent += 1
        elif delivery_result is False:
            failed += 1
        else:
            skipped += 1

    stats = {
        "due": len(due),
        "prepared": prepared,
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
    }
    log.info("Event reminder dispatch complete: %s", stats)
    return stats


def _reminder_window(now_utc: datetime) -> tuple[datetime, datetime]:
    target = now_utc + timedelta(minutes=_CONTROL.lead_minutes)
    return (
        target - timedelta(minutes=_CONTROL.late_tolerance_minutes),
        target + timedelta(minutes=_CONTROL.early_tolerance_minutes),
    )


def _load_due_reminders(
    window_start: datetime,
    window_end: datetime,
) -> list[dict]:
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select(
                    "user_id,event_id,event_date_id,"
                    "occurrence:event_dates!user_going_events_event_occurrence_fkey!inner"
                    "(id,dtstart_utc,dtend_utc),"
                    "event:events!fk_user_going_events_event_id!inner"
                    "(id,title,location,organization,category,cancelled)"
                )
                .gte("occurrence.dtstart_utc", window_start.isoformat())
                .lt("occurrence.dtstart_utc", window_end.isoformat())
                .eq("event.cancelled", False)
                .order("event_date_id")
                .order("user_id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )
    reminders: list[dict] = []
    for row in rows:
        event = dict(row.get("event") or {})
        occurrence = row.get("occurrence") or {}
        event["dtstart_utc"] = occurrence.get("dtstart_utc")
        event["dtend_utc"] = occurrence.get("dtend_utc")
        reminders.append(
            {
                "user_id": str(row["user_id"]),
                "event_date_id": str(row["event_date_id"]),
                "event": event,
            }
        )
    return reminders


def _load_users(user_ids: list[str]) -> dict[str, dict]:
    users: dict[str, dict] = {}
    for user_chunk in _chunks(user_ids):
        rows = (
            get_sb().table(USERS).select("id,email,school").in_("id", user_chunk).execute()
        ).data or []
        users.update({str(row["id"]): row for row in rows})
    return users


def _send_event_reminder(*, user: dict, reminder: dict) -> bool | None:
    user_id = str(user["id"])
    event = reminder["event"]
    occurrence_start = _canonical_occurrence_start(event["dtstart_utc"])
    target_id = f"{reminder['event_date_id']}:{occurrence_start}"
    row_id = claim_delivery(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_EVENT_REMINDER,
        target_id=target_id,
    )
    if row_id is None:
        return None

    tz = resolve_user_timezone(user)
    unsubscribe = unsubscribe_url(user_id, NOTIFICATION_TYPE_EVENT_REMINDER)
    preferences_url = f"{settings.frontend_url.rstrip('/')}/settings?tab=notifications"
    subject = event_reminder_subject(event)
    message = EmailMessage(
        to=str(user["email"]),
        subject=subject,
        body_html=render_event_reminder_html(
            subject=subject,
            event=event,
            tz=tz,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        body_text=render_event_reminder_text(
            subject=subject,
            event=event,
            tz=tz,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        idempotency_key=f"{NOTIFICATION_TYPE_EVENT_REMINDER}:{user_id}:{target_id}",
        headers={
            "List-Unsubscribe": f"<{unsubscribe}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )
    return deliver_claimed_email(
        row_id=row_id,
        message=message,
        provider_attempts=_CONTROL.provider_attempts,
        log_context=(
            f"notification=event_reminder user={user_id} occurrence={reminder['event_date_id']}"
        ),
    )


def _chunks(values: list[Any]) -> list[list[Any]]:
    return [values[start : start + _CHUNK_SIZE] for start in range(0, len(values), _CHUNK_SIZE)]


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _canonical_occurrence_start(value: Any) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return _aware_utc(parsed).isoformat()
