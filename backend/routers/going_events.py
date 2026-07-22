import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.errors import EVENT_NOT_FOUND
from core.exceptions import NotFoundError
from schemas.going_event import (
    EventAttendeesResponse,
    GoingEventSelection,
    GoingEventSelectionUpdate,
    GoingEventStatusResponse,
)
from services import event_service, going_event_service

router = APIRouter(prefix="/going-events", tags=["going-events"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[GoingEventSelection])
def list_going_events(user=Depends(get_db_user)):
    try:
        return going_event_service.get_going_event_selections(str(user.id))
    except APIError as e:
        log.warning("going_events table unavailable: %s", e)
        return []


@router.get("/{event_id}/attendees", response_model=EventAttendeesResponse)
def list_event_attendees(event_id: int):
    """Public who's-going summary for an event's details view."""
    if event_service.get_event(event_id) is None:
        raise NotFoundError(EVENT_NOT_FOUND)

    counts = going_event_service.get_going_counts_for_events([event_id])
    return {
        "going_count": counts.get(event_id, 0),
        "names": going_event_service.get_attendee_display_names(event_id),
    }


@router.put(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=GoingEventStatusResponse,
)
def mark_going(
    event_id: int,
    data: GoingEventSelectionUpdate,
    user=Depends(get_db_user),
):
    return going_event_service.set_going_occurrences(
        str(user.id),
        event_id,
        data.occurrence_ids,
    )


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=GoingEventStatusResponse,
)
def unmark_going(event_id: int, user=Depends(get_db_user)):
    return going_event_service.set_going_occurrences(str(user.id), event_id, [])
