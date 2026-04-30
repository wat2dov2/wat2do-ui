import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.constants import MAX_RSVPS_PER_USER
from core.errors import EVENT_NOT_FOUND, RSVPS_CAP_REACHED
from core.exceptions import NotFoundError, ValidationError
from schemas.event_rsvp import RsvpEventStatusResponse
from services import event_rsvp_service, event_service

router = APIRouter(prefix="/event-rsvps", tags=["event-rsvps"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_rsvp_events(user=Depends(get_db_user)):
    """Return event IDs the current user has RSVP'd 'going' to."""
    try:
        return event_rsvp_service.get_rsvp_event_ids(str(user.id))
    except APIError as e:
        log.warning("user_event_rsvps table unavailable: %s", e)
        return []


@router.put(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=RsvpEventStatusResponse,
)
def rsvp_event(event_id: int, user=Depends(get_db_user)):
    """RSVP 'going' to an event.

    - 404 if the event does not exist.
    - 400 if the user has already hit ``MAX_RSVPS_PER_USER``.
    """
    if event_service.get_event(event_id) is None:
        raise NotFoundError(EVENT_NOT_FOUND)

    count = event_rsvp_service.count_rsvps(str(user.id))
    if count >= MAX_RSVPS_PER_USER:
        raise ValidationError(RSVPS_CAP_REACHED)

    event_rsvp_service.rsvp_event(str(user.id), event_id)
    return {"status": "going"}


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=RsvpEventStatusResponse,
)
def unrsvp_event(event_id: int, user=Depends(get_db_user)):
    """Cancel an RSVP."""
    event_rsvp_service.unrsvp_event(str(user.id), event_id)
    return {"status": "not_going"}
