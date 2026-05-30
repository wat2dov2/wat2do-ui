"""Notification type, status, and channel constants."""

from typing import Final

# Plain text values in notification_preferences.notification_type and
# notifications_log.notification_type. Add a new type here, update the
# Literal alias in schemas/notification_preference.py, and include a default.
NOTIFICATION_TYPE_MORNING_DIGEST: Final = "morning_digest"
NOTIFICATION_TYPE_WEEKLY_DIGEST: Final = "weekly_digest"
NOTIFICATION_TYPE_EVENT_CHANGE: Final = "event_change"
NOTIFICATION_TYPE_DAILY_NEW_EVENTS: Final = "daily_new_events"

NOTIFICATION_TYPES = (
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
)

NOTIFICATION_DEFAULT_ENABLED: dict[str, bool] = {
    NOTIFICATION_TYPE_MORNING_DIGEST: True,
    NOTIFICATION_TYPE_WEEKLY_DIGEST: True,
    NOTIFICATION_TYPE_EVENT_CHANGE: True,
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS: False,
}

NOTIFICATION_STATUS_PENDING: Final = "pending"
NOTIFICATION_STATUS_SENT: Final = "sent"
NOTIFICATION_STATUS_FAILED: Final = "failed"

NOTIFICATION_CHANNEL_EMAIL: Final = "email"
