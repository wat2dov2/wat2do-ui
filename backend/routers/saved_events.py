import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_current_user, resolve_db_user
from services import saved_event_service

router = APIRouter(prefix="/saved-events", tags=["saved-events"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_saved_events(auth_user: dict = Depends(get_current_user)):
    """Return event IDs saved by the current user."""
    user = resolve_db_user(auth_user)
    try:
        return saved_event_service.get_saved_event_ids(str(user.id))
    except APIError as e:
        log.warning("saved_events table unavailable: %s", e)
        return []


@router.put("/{event_id}", status_code=status.HTTP_200_OK)
def save_event(event_id: int, auth_user: dict = Depends(get_current_user)):
    """Save (bookmark) an event."""
    user = resolve_db_user(auth_user)
    saved_event_service.save_event(str(user.id), event_id)
    return {"status": "saved"}


@router.delete("/{event_id}", status_code=status.HTTP_200_OK)
def unsave_event(event_id: int, auth_user: dict = Depends(get_current_user)):
    """Remove a saved event."""
    user = resolve_db_user(auth_user)
    saved_event_service.unsave_event(str(user.id), event_id)
    return {"status": "unsaved"}
