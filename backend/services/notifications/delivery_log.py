"""Retryable notification delivery claims and terminal status updates."""

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from core.constants import (
    NOTIFICATION_STATUS_FAILED,
    NOTIFICATION_STATUS_SENT,
)
from core.database import get_sb
from core.tables import NOTIFICATIONS_LOG
from services.email_service import EmailMessage, email_service

log = logging.getLogger(__name__)


def claim_delivery(
    *,
    user_id: str,
    notification_type: str,
    target_id: str,
    changed_fields: dict | None = None,
) -> str | None:
    """Claim a new, failed, or stale delivery. Return None if already owned/sent."""
    response = (
        get_sb()
        .rpc(
            "claim_notification_delivery",
            {
                "p_user_id": user_id,
                "p_notification_type": notification_type,
                "p_target_id": target_id,
                "p_changed_fields": changed_fields,
            },
        )
        .execute()
    )
    if not response.data:
        return None
    row: Any = response.data[0]
    return str(row["id"]) if row.get("claimed") else None


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


def _mark_log_failed(row_id: str, failure_category: str = "provider_error") -> None:
    (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .update(
            {
                "status": NOTIFICATION_STATUS_FAILED,
                "failure_category": failure_category,
            }
        )
        .eq("id", row_id)
        .execute()
    )


def deliver_claimed_email(
    *,
    row_id: str,
    message: EmailMessage,
    provider_attempts: int,
    log_context: str,
) -> bool:
    """Send one claimed notification and commit its terminal delivery status."""
    failure_category = "provider_error"
    for _attempt in range(provider_attempts):
        try:
            email_service.send(message)
            _mark_log_sent(row_id)
            return True
        except httpx.HTTPStatusError as exc:
            failure_category = f"provider_http_{exc.response.status_code}"
            if 400 <= exc.response.status_code < 500 and exc.response.status_code != 429:
                break
        except httpx.TimeoutException:
            failure_category = "provider_timeout"
        except Exception:
            log.warning(
                "Notification provider failure %s",
                log_context,
                exc_info=True,
            )
            break

    _mark_log_failed(row_id, failure_category)
    return False
