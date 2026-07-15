import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.constants import MAX_GOING_EVENTS_PER_USER
from core.errors import EVENT_NOT_FOUND, GOING_EVENTS_CAP_REACHED
from core.exceptions import NotFoundError, ValidationError
from schemas.going_event import GoingEventStatusResponse
from services import event_service, going_event_service

router = APIRouter(prefix="/going-events", tags=["going-events"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_going_events(user=Depends(get_db_user)):
    try:
        return going_event_service.get_going_event_ids(str(user.id))
    except APIError as e:
        log.warning("going_events table unavailable: %s", e)
        return []


@router.put(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=GoingEventStatusResponse,
)
def mark_going(event_id: int, user=Depends(get_db_user)):
    """Mark an event as going.

    - 404 if the event does not exist.
    - 400 if the user has already hit ``MAX_GOING_EVENTS_PER_USER``.
    """
    if event_service.get_event(event_id) is None:
        raise NotFoundError(EVENT_NOT_FOUND)

    # Cap check is pre-insert only; re-mark of the same event is not
    # idempotent at the cap layer (unique constraint still makes the write safe).
    count = going_event_service.count_going_events(str(user.id))
    if count >= MAX_GOING_EVENTS_PER_USER:
        raise ValidationError(GOING_EVENTS_CAP_REACHED)

    going_event_service.mark_going(str(user.id), event_id)
    return {
        "status": "going",
        "going_count": going_event_service.count_going_for_event(event_id),
    }


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=GoingEventStatusResponse,
)
def unmark_going(event_id: int, user=Depends(get_db_user)):
    going_event_service.unmark_going(str(user.id), event_id)
    return {
        "status": "not_going",
        "going_count": going_event_service.count_going_for_event(event_id),
    }
