"""Notification delivery-log helpers.

The UNIQUE (user_id, notification_type, target_id, channel) key is what makes
email sends safe across worker restarts and concurrent runs.
"""

from datetime import datetime, timezone
from typing import Any

from core.constants import (
    NOTIFICATION_CHANNEL_EMAIL,
    NOTIFICATION_STATUS_FAILED,
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_SENT,
    PG_UNIQUE_VIOLATION,
)
from core.database import get_sb
from core.tables import NOTIFICATIONS_LOG


def _try_insert_log_row(
    *,
    user_id: str,
    notification_type: str,
    target_id: str,
    changed_fields: dict | None = None,
    channel: str = NOTIFICATION_CHANNEL_EMAIL,
) -> str | None:
    """Insert a ``pending`` log row. Return the row id, or None on dedup."""
    payload: dict[str, Any] = {
        "user_id": user_id,
        "notification_type": notification_type,
        "target_id": target_id,
        "channel": channel,
        "status": NOTIFICATION_STATUS_PENDING,
    }
    if changed_fields is not None:
        payload["changed_fields"] = changed_fields
    try:
        r = get_sb().table(NOTIFICATIONS_LOG).insert(payload).execute()
    except Exception as e:
        if PG_UNIQUE_VIOLATION in str(e):
            return None
        raise
    if r.data:
        return r.data[0]["id"]
    return None


def _mark_log_sent(row_id: str) -> None:
    (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .update(
            {
                "status": NOTIFICATION_STATUS_SENT,
                "sent_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", row_id)
        .execute()
    )


def _mark_log_failed(row_id: str) -> None:
    (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .update({"status": NOTIFICATION_STATUS_FAILED})
        .eq("id", row_id)
        .execute()
    )
