"""Going-event change notification fanout.

A database trigger records each event as it was before its first material
change (``event_change_alerts``). Once an event has been quiet for
``controlbox.event_change_alerts.quiet_minutes``, ``send_due_alerts`` compares
that record with the event as it is now and sends everyone who was going one
email covering every change in the burst.
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from itertools import batched
from typing import Any
from uuid import UUID

from core.constants import NOTIFICATION_TYPE_EVENT_CHANGE
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import EVENT_CHANGE_ALERTS, USERS
from schemas.event import EventResponse
from services import event_service
from services.email_service import EmailMessage
from services.notifications.delivery_log import (
    claim_delivery,
    deliver_claimed_email,
)
from services.notifications.preferences import get_enabled_user_ids
from services.notifications.rendering import (
    _render_event_change_html,
    _render_event_change_text,
)

log = logging.getLogger(__name__)


def send_due_alerts(now: datetime | None = None) -> int:
    """Send one alert per event whose recorded changes have gone quiet.

    Returns the number of emails sent. A row is cleared only if no newer
    change arrived while it was being sent; a retried send is deduplicated
    by the delivery log.
    """
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(
        minutes=controlbox.event_change_alerts.quiet_minutes
    )
    rows = (
        get_sb()
        .table(EVENT_CHANGE_ALERTS)
        .select("event_id,snapshot,changed_at")
        .lte("changed_at", cutoff.isoformat())
        .execute()
    ).data or []
    sent = 0
    for row in rows:
        try:
            sent += _send_alert(row["event_id"], row["snapshot"])
        except Exception:
            log.warning("Going alert failed for event id=%s", row["event_id"], exc_info=True)
            continue
        get_sb().table(EVENT_CHANGE_ALERTS).delete().eq("event_id", row["event_id"]).eq(
            "changed_at", row["changed_at"]
        ).execute()
    return sent


def _send_alert(event_id: int, snapshot: dict) -> int:
    current = event_service.get_event(event_id)
    if current is None:
        return 0
    before = EventResponse.model_validate(
        {
            **current.model_dump(),
            "location": snapshot["location"],
            "cancelled": snapshot["cancelled"],
            "occurrences": snapshot["occurrences"],
        }
    )
    diff = event_service.compute_event_diff(before, current)
    recipients = [UUID(user_id) for user_id in snapshot.get("going_user_ids") or []]
    return enqueue_event_change(current, diff, recipients)


def _compute_change_hash(diff: dict[str, dict[str, Any]]) -> str:
    """Stable short hash over the diff content for dedup.

    Idempotent rediscovery of the same diff collapses to one log row.
    A second distinct change to the same event gets its own hash and
    therefore its own send.
    """
    payload = json.dumps(diff, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def enqueue_event_change(
    event: EventResponse,
    diff: dict[str, dict[str, Any]],
    recipient_ids: list[UUID],
) -> int:
    """Fanout an event_change alert to everyone going to the event.

    Returns the number of emails actually sent (after prefs + dedup).
    No-op on empty diff. Safe to call on missing events.
    """
    if not diff:
        return 0

    event_id = event.id
    event_summary = event.model_dump(mode="json")
    user_ids = list(dict.fromkeys(str(user_id) for user_id in recipient_ids))
    if not user_ids:
        return 0

    users: list[dict] = []
    for chunk in batched(user_ids, 500):
        users.extend(
            (get_sb().table(USERS).select("id,email").in_("id", list(chunk)).execute()).data or []
        )
    by_id = {u["id"]: u for u in users}
    enabled_user_ids = get_enabled_user_ids(
        user_ids,
        NOTIFICATION_TYPE_EVENT_CHANGE,
    )

    change_hash = _compute_change_hash(diff)
    target_id = f"{event_id}:{change_hash}"

    sent = 0
    for user_id in user_ids:
        user = by_id.get(user_id)
        if not user or not user.get("email"):
            continue
        if user_id not in enabled_user_ids:
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
    row_id = claim_delivery(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
        target_id=target_id,
        changed_fields=diff,
    )
    if row_id is None:
        return False
    title = event_summary.get("title") or "an event you're going to"
    subject = f"Update: {title}"
    return deliver_claimed_email(
        row_id=row_id,
        message=EmailMessage(
            to=email,
            subject=subject,
            body_html=_render_event_change_html(event_summary, diff),
            body_text=_render_event_change_text(event_summary, diff),
            idempotency_key=f"{NOTIFICATION_TYPE_EVENT_CHANGE}:{user_id}:{target_id}",
        ),
        provider_attempts=1,
        log_context=f"notification=event_change user={user_id} event={event_id}",
    )
