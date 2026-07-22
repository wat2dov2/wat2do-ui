"""Notification type, status, and channel constants."""

from typing import Final

from core.product_control import product_control

# Plain text values in notification_preferences.notification_type and
# notifications_log.notification_type. Add a new type here, update the
# Literal alias in schemas/notification_preference.py, and include a default.
NOTIFICATION_TYPE_MORNING_EMAIL: Final = "morning_email"
NOTIFICATION_TYPE_EVENT_CHANGE: Final = "event_change"

NOTIFICATION_TYPES = (
    NOTIFICATION_TYPE_MORNING_EMAIL,
    NOTIFICATION_TYPE_EVENT_CHANGE,
)

NOTIFICATION_DEFAULT_ENABLED: dict[str, bool] = {
    NOTIFICATION_TYPE_MORNING_EMAIL: product_control.notification_defaults.morning_email,
    NOTIFICATION_TYPE_EVENT_CHANGE: product_control.notification_defaults.event_change,
}

NOTIFICATION_STATUS_PENDING: Final = "pending"
NOTIFICATION_STATUS_SENT: Final = "sent"
NOTIFICATION_STATUS_FAILED: Final = "failed"

NOTIFICATION_CHANNEL_EMAIL: Final = "email"
