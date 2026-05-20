"""Saved-event change notification fanout."""

import hashlib
import json
import logging
from typing import Any

from core.constants import NOTIFICATION_TYPE_EVENT_CHANGE
from core.database import get_sb
from core.tables import EVENTS, USER_SAVED_EVENTS, USERS
from services.email_service import EmailMessage, email_service
from services.notifications.delivery_log import (
    _mark_log_failed,
    _mark_log_sent,
    _try_insert_log_row,
)
from services.notifications.preferences import is_enabled
from services.notifications.rendering import (
    _render_event_change_html,
    _render_event_change_text,
)

log = logging.getLogger(__name__)


def _compute_change_hash(diff: dict[str, dict[str, Any]]) -> str:
    """Stable short hash over the diff content for dedup.

    Idempotent rediscovery of the same diff collapses to one log row.
    A second distinct change to the same event gets its own hash and
    therefore its own send.
    """
    payload = json.dumps(diff, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def enqueue_event_change(event_id: int, diff: dict[str, dict[str, Any]]) -> int:
    """Fanout an event_change alert to everyone who saved the event.

    Returns the number of emails actually sent (after prefs + dedup).
    No-op on empty diff. Safe to call on missing events.
    """
    if not diff:
        return 0

    event_row = (
        get_sb()
        .table(EVENTS)
        .select("title, location, status")
        .eq("id", event_id)
        .limit(1)
        .execute()
    ).data or []
    if not event_row:
        log.warning("enqueue_event_change: event %s not found", event_id)
        return 0
    event_summary = event_row[0]

    saved_rows = (
        get_sb().table(USER_SAVED_EVENTS).select("user_id").eq("event_id", event_id).execute()
    ).data or []
    user_ids = [r["user_id"] for r in saved_rows]
    if not user_ids:
        return 0

    users = (get_sb().table(USERS).select("id, email").in_("id", user_ids).execute()).data or []
    by_id = {u["id"]: u for u in users}

    change_hash = _compute_change_hash(diff)
    target_id = f"{event_id}:{change_hash}"

    sent = 0
    for user_id in user_ids:
        user = by_id.get(user_id)
        if not user or not user.get("email"):
            continue
        if not is_enabled(user_id, NOTIFICATION_TYPE_EVENT_CHANGE):
            continue
        if _send_event_change(
            user_id=user_id,
            email=user["email"],
            event_id=event_id,
            event_summary=event_summary,
            diff=diff,
            target_id=target_id,
        ):
            sent += 1
    return sent


def _send_event_change(
    *,
    user_id: str,
    email: str,
    event_id: int,
    event_summary: dict,
    diff: dict,
    target_id: str,
) -> bool:
    row_id = _try_insert_log_row(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
        target_id=target_id,
        changed_fields=diff,
    )
    if row_id is None:
        return False
    subject = f"Update: {event_summary.get('title', 'an event you saved')}"
    try:
        email_service.send(
            EmailMessage(
                to=email,
                subject=subject,
                body_html=_render_event_change_html(event_summary, diff),
                body_text=_render_event_change_text(event_summary, diff),
                idempotency_key=f"{NOTIFICATION_TYPE_EVENT_CHANGE}:{user_id}:{target_id}",
            )
        )
    except Exception as e:
        log.warning("event_change send failed user=%s event=%s: %s", user_id, event_id, e)
        _mark_log_failed(row_id)
        return False
    _mark_log_sent(row_id)
    return True
