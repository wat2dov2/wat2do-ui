"""User notification preference schemas.

Row-per-type model (see migration comments): each (user, type) pair can
have an explicit ``enabled`` value, and missing rows resolve to the
code default in ``core.constants.NOTIFICATION_DEFAULT_ENABLED``.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from core.constants import (
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
)

# Literal alias — canonical set of valid notification_type values.
# Add a new member here AND in core/constants.NOTIFICATION_TYPES in the
# same change. Pydantic enforces this at the API boundary; the DB
# column stays plain text so adding a type is a code change only.
NotificationType = Literal[
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
]


class NotificationPreferenceResponse(BaseModel):
    """Single preference row as returned from the API."""

    notification_type: NotificationType
    enabled: bool
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class NotificationPreferenceUpdate(BaseModel):
    """One preference-flip in a bulk update payload."""

    model_config = ConfigDict(extra="forbid")

    notification_type: NotificationType
    enabled: bool


class NotificationPreferencesBulkUpdate(BaseModel):
    """Settings-page payload: flip multiple toggles in one call.

    The settings UI typically shows every type as a toggle; letting the
    client send them in one request avoids N round-trips and lines up
    cleanly with an UPSERT on the (user_id, notification_type) key.
    """

    model_config = ConfigDict(extra="forbid")

    preferences: list[NotificationPreferenceUpdate] = Field(..., min_length=1, max_length=32)


class NotificationPreferencesListResponse(BaseModel):
    """GET response: every type's current resolved state for the user.

    Includes types for which the user has no row (default-on); the
    ``enabled`` value is the resolved default in that case. Clients
    render one toggle per entry.
    """

    preferences: list[NotificationPreferenceResponse]
