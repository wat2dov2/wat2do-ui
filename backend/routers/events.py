import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_authorized_resource, get_db_user, is_admin
from core.constants import (
    MAX_EVENT_PRICE,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
)
from core.errors import (
    EVENT_NOT_FOUND,
    ORGANIZATION_EVENT_CREATION_REQUIRED,
    ORGANIZATION_NOT_FOUND,
)
from core.exceptions import AuthorizationError, get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.event import (
    EventCreate,
    EventEmailNotificationResponse,
    EventPublicResponse,
    EventResponse,
    EventSummaryResponse,
    EventUpdate,
    LatestEventResponse,
)
from schemas.user import UserResponse
from services import event_service, organization_service
from services.notifications import event_change, event_email

log = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])
EventSortBy = Literal["date", "title", "location", "price", "added_at"]
EventSortOrder = Literal["asc", "desc"]


def _get_event_or_404_authorized(event_id: int, db_user: UserResponse) -> EventResponse:
    """Fetch an event by ID (404 if missing) and verify the user is its owner or an admin (403 if not)."""
    return get_authorized_resource(
        lambda: event_service.get_event(event_id),
        EVENT_NOT_FOUND,
        db_user,
    )


def _authorize_event_organization(organization_id: int, db_user: UserResponse) -> None:
    """Verify the user may publish events under a organization (owns it, or is admin).

    The event's display fields are derived from the organization server-side
    (event_service._resolve_organization_fields); this helper only enforces the
    "you can only post for organizations you own" authorization rule.
    """
    organization = get_or_404(
        organization_service.get_organization(organization_id), ORGANIZATION_NOT_FOUND
    )
    if not is_admin(db_user):
        owned_organizations = organization_service.list_organizations_by_owner(str(db_user.id))
        if not any(c.id == organization.id for c in owned_organizations):
            raise AuthorizationError(ORGANIZATION_EVENT_CREATION_REQUIRED)


@router.get("/latest-added", response_model=LatestEventResponse | None)
def get_latest_added(
    school: str | None = Query(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH),
):
    """Return the most recently added event (title + added_at) for UI text like 'X added 22 minutes ago'."""
    if school == "all":
        school = None
    return event_service.get_latest_added_event(school)


@router.get("/promoted", response_model=list[EventSummaryResponse])
def list_promoted_events(
    school: str | None = Query(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH),
):
    """Public browse list: only promoted events for a school."""
    if school == "all":
        school = None
    return event_service.list_promoted_events(school=school)


@router.get("/", response_model=PaginatedResponse[EventSummaryResponse])
def list_events(
    school: str | None = Query(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    categories: list[str] | None = Query(default=None),
    locations: list[str] | None = Query(default=None),
    foods: list[str] | None = Query(default=None),
    days: list[str] | None = Query(default=None),
    min_price: float | None = Query(default=None, ge=0, le=MAX_EVENT_PRICE),
    max_price: float | None = Query(default=None, ge=0, le=MAX_EVENT_PRICE),
    registration: bool | None = Query(default=None),
    organizations: list[str] | None = Query(default=None),
    free_food: bool = Query(default=False),
    ids: list[int] | None = Query(default=None),
    sort_by: EventSortBy = Query(default="date"),
    sort_order: EventSortOrder = Query(default="asc"),
    start_utc: datetime | None = Query(default=None),
    end_utc: datetime | None = Query(default=None),
    pagination: PaginationParams = Depends(),
):
    """Public browse list for a school.

    By default this returns the current upcoming set. ``start_utc`` and
    ``end_utc`` expose the same occurrence-window read path for clients that
    need a wider or narrower date range. The response omits ``created_by`` via
    ``EventSummaryResponse`` (audit I10 / S16).
    """
    if school == "all":
        school = None
    items, total = event_service.list_events(
        school=school,
        skip=pagination.offset,
        limit=pagination.page_size,
        start_utc=start_utc,
        end_utc=end_utc,
        search=search,
        categories=categories,
        locations=locations,
        foods=foods,
        days=days,
        min_price=min_price,
        max_price=max_price,
        registration=registration,
        organizations=organizations,
        free_food=free_food,
        ids=ids,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return paginated_response(items, total, pagination)


@router.get("/{event_id}", response_model=EventPublicResponse)
def get_event(event_id: int):
    """Public event detail.  ``created_by`` is stripped via
    ``EventPublicResponse`` (audit I10 / S16); owners / admins see the
    full shape through their dashboards via the dedicated service call.
    """
    return get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)


@router.post("/{event_id}/email-notification", response_model=EventEmailNotificationResponse)
def send_event_email_notification(
    event_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    event = get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)
    return EventEmailNotificationResponse(
        sent=event_email.send_event_email_notification(event=event, user=db_user)
    )


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    _authorize_event_organization(data.organization_id, db_user)
    return event_service.create_event(data, created_by=str(db_user.id))


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    data: EventUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    old_event = _get_event_or_404_authorized(event_id, db_user)
    # Reassigning to a different organization requires ownership of the target organization
    # (or admin), mirroring the create-time authorization rule.
    if data.organization_id is not None:
        _authorize_event_organization(data.organization_id, db_user)
    updated_event = get_or_404(event_service.update_event(event_id, data), EVENT_NOT_FOUND)
    # Event-change notifications — fires on material diff only; routes stay
    # ignorant of what "material" means (that's compute_event_diff). Wrap
    # in try/except so a notification failure never breaks the update.
    diff = event_service.compute_event_diff(old_event, updated_event)
    if diff:
        try:
            event_change.enqueue_event_change(event_id, diff)
        except Exception as e:
            log.warning("enqueue_event_change failed event=%s: %s", event_id, e)
    return updated_event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_event_or_404_authorized(event_id, db_user)
    event_service.delete_event(event_id)
