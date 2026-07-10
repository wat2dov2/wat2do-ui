"""User notification preference GET/PATCH."""

from fastapi import APIRouter, Depends, status

from core.auth import get_db_user
from schemas.notification_preference import (
    NotificationPreferencesBulkUpdate,
    NotificationPreferencesListResponse,
)
from schemas.user import UserResponse
from services.notifications import preferences

router = APIRouter(
    prefix="/notification-preferences",
    tags=["notifications"],
)


@router.get("", response_model=NotificationPreferencesListResponse)
def get_my_preferences(
    db_user: UserResponse = Depends(get_db_user),
) -> NotificationPreferencesListResponse:
    """Return resolved preferences for the authenticated user.

    Always one entry per supported type - untouched types come back with
    their default and ``updated_at=None`` so the client can distinguish
    default-on from explicitly opted in.
    """
    prefs = preferences.get_preferences(str(db_user.id))
    return NotificationPreferencesListResponse(preferences=prefs)


@router.patch("", status_code=status.HTTP_204_NO_CONTENT)
def update_my_preferences(
    payload: NotificationPreferencesBulkUpdate,
    db_user: UserResponse = Depends(get_db_user),
) -> None:
    preferences.set_preferences(str(db_user.id), payload.preferences)
