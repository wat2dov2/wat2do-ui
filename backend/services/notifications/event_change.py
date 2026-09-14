"""Going-event change notification fanout."""

import hashlib
import json
from itertools import batched
from typing import Any
from uuid import UUID

from core.constants import NOTIFICATION_TYPE_EVENT_CHANGE
from core.database import get_sb
from core.tables import USERS
from schemas.event import EventResponse
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
