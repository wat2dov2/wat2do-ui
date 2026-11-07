"""Notification preference types.

Row-per-type model (see migration comments): each (user, type) pair can
have an explicit ``enabled`` value, and missing rows resolve to the
code default in ``core.constants.NOTIFICATION_DEFAULT_ENABLED``. The API
(``rust/src/api/routes/notification_preferences.rs``) reads and writes them.
"""

from typing import Literal

from core.constants import (
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)

# Literal alias - canonical set of valid notification_type values.
# Add a new member here AND in core/constants.NOTIFICATION_TYPES (and
# rust/src/constants.rs) in the same change. The DB column stays plain text,
# so adding a type is a code change only.
NotificationType = Literal[
    NOTIFICATION_TYPE_MORNING_EMAIL,
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_EVENT_CHANGE,
]
