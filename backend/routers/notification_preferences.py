"""User notification preference GET/PATCH."""

from html import escape

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import HTMLResponse

from core.auth import get_db_user
from schemas.notification_preference import (
    NotificationPreferencesBulkUpdate,
    NotificationPreferencesListResponse,
)
from schemas.user import UserResponse
from services.notifications import preferences, unsubscribe

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


@router.get("/unsubscribe", response_class=HTMLResponse)
def confirm_unsubscribe(token: str = Query(...)) -> HTMLResponse:
    valid = unsubscribe.verify_unsubscribe_token(token) is not None
    message = (
        "Confirm that you want to stop these wat2do emails."
        if valid
        else "This unsubscribe link is invalid."
    )
    action = (
        f'<form method="post" action="?token={escape(token, quote=True)}">'
        '<button type="submit">Unsubscribe</button></form>'
        if valid
        else ""
    )
    return HTMLResponse(
        "<!doctype html><html><body>"
        f"<h1>wat2do email preferences</h1><p>{message}</p>{action}"
        "</body></html>"
    )


@router.post("/unsubscribe", response_class=HTMLResponse)
def apply_unsubscribe(token: str = Query(...)) -> HTMLResponse:
    unsubscribe.unsubscribe(token)
    return HTMLResponse(
        "<!doctype html><html><body><h1>Email preference updated</h1>"
        "<p>If the link was valid, this email notification has been turned off.</p>"
        "</body></html>"
    )
