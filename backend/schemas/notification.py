"""Notifications log shape — internal only (no API exposure in v1).

If we ever ship a ``GET /me/notifications`` history endpoint, the
response models live here. For now the log is write-only from the
worker's perspective and queried directly in admin/debug contexts.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from core.constants import (
    NOTIFICATION_STATUS_FAILED,
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_SENT,
)
from schemas.notification_preference import NotificationType

NotificationStatus = Literal[
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_SENT,
    NOTIFICATION_STATUS_FAILED,
]


class NotificationLogEntry(BaseModel):
    """One row of ``notifications_log`` — what the worker inserts/updates."""

    id: str
    user_id: str
    notification_type: NotificationType
    target_id: str
    channel: str
    status: NotificationStatus
    changed_fields: dict | None = None
    sent_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
