"""Notification preferences — user-facing settings surface.

GET  /notification-preferences  -> every type's resolved state
PATCH /notification-preferences -> bulk-upsert one or more types

Auto-discovered by main.py via the module's ``router`` attribute.
"""

from fastapi import APIRouter, Depends, status

from core.auth import get_db_user
from schemas.notification_preference import (
    NotificationPreferencesBulkUpdate,
    NotificationPreferencesListResponse,
)
from schemas.user import UserResponse
from services import notification_service

router = APIRouter(
    prefix="/notification-preferences",
    tags=["notifications"],
)


@router.get("", response_model=NotificationPreferencesListResponse)
def get_my_preferences(
    db_user: UserResponse = Depends(get_db_user),
) -> NotificationPreferencesListResponse:
    """Return the resolved preferences for the authenticated user.

    Always includes one entry per supported type — types the user has
    never toggled come back with their default value and
    ``updated_at=None`` so the client can distinguish "default-on" from
    "explicitly opted in".
    """
    prefs = notification_service.get_preferences(str(db_user.id))
    return NotificationPreferencesListResponse(preferences=prefs)


@router.patch("", status_code=status.HTTP_204_NO_CONTENT)
def update_my_preferences(
    payload: NotificationPreferencesBulkUpdate,
    db_user: UserResponse = Depends(get_db_user),
) -> None:
    """Bulk-upsert preferences for the authenticated user."""
    notification_service.set_preferences(str(db_user.id), payload.preferences)
