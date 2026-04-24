import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_authorized_resource, get_db_user
from schemas.user import UserResponse
from core.exceptions import get_or_404
from core.constants import (
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    MAX_EVENT_CATEGORY_LENGTH,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
)
from schemas.event import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventPublicResponse,
    EventSummaryResponse,
    LatestEventResponse,
)
from core.errors import EVENT_NOT_FOUND
from services import event_service, notification_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


def _get_event_or_404_authorized(event_id: int, db_user: UserResponse) -> EventResponse:
    """Fetch an event by ID (404 if missing) and verify the user is its owner or an admin (403 if not)."""
    return get_authorized_resource(
        lambda: event_service.get_event(event_id), EVENT_NOT_FOUND, db_user,
    )


@router.get("/latest-added", response_model=LatestEventResponse | None)
def get_latest_added():
    """Return the most recently added event (title + added_at) for UI text like 'X added 22 minutes ago'."""
    return event_service.get_latest_added_event()


@router.get("/", response_model=list[EventSummaryResponse])
def list_events(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    category: str | None = Query(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH),
    club_type: str | None = Query(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH),
    school: str | None = Query(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    has_food: bool | None = None,
    max_price: float | None = Query(default=None, ge=0, allow_inf_nan=False),
    registration: bool | None = None,
    summary: bool = Query(default=False, description="Return lightweight card-view fields only"),
    include_cancelled: bool = Query(
        default=False,
        description="Include cancelled events. Default excludes them so browse/search stays clean.",
    ),
):
    """Public list endpoint.

    Response shape is fixed to ``EventSummaryResponse`` which omits
    ``created_by`` — this is the IDOR/PII fix for audit I10/S16.  The
    ``summary`` flag is still forwarded to the service (so the query
    can short-circuit large column reads) but the wire shape is the
    same either way.  FastAPI's response_model serialization will drop
    any extra fields if the service returns the fuller ``EventResponse``.
    """
    return event_service.list_events(
        skip=skip,
        limit=limit,
        category=category,
        club_type=club_type,
        school=school,
        search=search,
        from_date=from_date,
        to_date=to_date,
        has_food=has_food,
        max_price=max_price,
        registration=registration,
        summary=summary,
        include_cancelled=include_cancelled,
    )


@router.get("/{event_id}", response_model=EventPublicResponse)
def get_event(event_id: int):
    """Public event detail.  ``created_by`` is stripped via
    ``EventPublicResponse`` (audit I10 / S16); owners / admins see the
    full shape through their dashboards via the dedicated service call.
    """
    return get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    return event_service.create_event(data, created_by=str(db_user.id))


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    data: EventUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    old_event = _get_event_or_404_authorized(event_id, db_user)
    updated_event = get_or_404(
        event_service.update_event(event_id, data), EVENT_NOT_FOUND
    )
    # Event-change notifications — fires on material diff only; routes stay
    # ignorant of what "material" means (that's compute_event_diff). Wrap
    # in try/except so a notification failure never breaks the update.
    diff = event_service.compute_event_diff(old_event, updated_event)
    if diff:
        try:
            notification_service.enqueue_event_change(event_id, diff)
        except Exception as e:
            log.warning(
                "enqueue_event_change failed event=%s: %s", event_id, e
            )
    return updated_event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_event_or_404_authorized(event_id, db_user)
    event_service.delete_event(event_id)
