import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.constants import MAX_SAVED_EVENTS_PER_USER
from core.errors import EVENT_NOT_FOUND, SAVED_EVENTS_CAP_REACHED
from core.exceptions import NotFoundError, ValidationError
from schemas.saved_event import SaveEventStatusResponse
from services import event_service, saved_event_service

router = APIRouter(prefix="/saved-events", tags=["saved-events"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_saved_events(user=Depends(get_db_user)):
    """Return event IDs saved by the current user."""
    try:
        return saved_event_service.get_saved_event_ids(str(user.id))
    except APIError as e:
        log.warning("saved_events table unavailable: %s", e)
        return []


@router.put(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveEventStatusResponse,
)
def save_event(event_id: int, user=Depends(get_db_user)):
    """Save (bookmark) an event.

    - 404 if the referenced event does not exist (audit I9).
    - 400 if the user has already hit ``MAX_SAVED_EVENTS_PER_USER`` —
      prevents a single account from growing an unbounded bookmark list
      and OOM'ing the listing endpoint (audit I8).
    """
    if event_service.get_event(event_id) is None:
        raise NotFoundError(EVENT_NOT_FOUND)

    # Check cap BEFORE inserting.  The cap is a soft-safety-net; the
    # unique(user_id, event_id) constraint means an existing save for
    # this event is idempotent and therefore should not count toward
    # the cap — but for simplicity we only check cap on fresh inserts.
    count = saved_event_service.count_saved_events(str(user.id))
    if count >= MAX_SAVED_EVENTS_PER_USER:
        raise ValidationError(SAVED_EVENTS_CAP_REACHED)

    saved_event_service.save_event(str(user.id), event_id)
    return {"status": "saved"}


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveEventStatusResponse,
)
def unsave_event(event_id: int, user=Depends(get_db_user)):
    """Remove a saved event."""
    saved_event_service.unsave_event(str(user.id), event_id)
    return {"status": "unsaved"}
