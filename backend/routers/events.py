import logging
from concurrent.futures import ThreadPoolExecutor
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
    ORGANIZATION_PENDING_REVIEW,
)
from core.exceptions import AuthorizationError, get_or_404
from core.pagination import PaginationParams, paginated_response
from schemas.event import (
    EventCreate,
    EventFeedResponse,
    EventPublicResponse,
    EventResponse,
    EventStatsResponse,
    EventSummaryResponse,
    EventUpdate,
)
from schemas.organization import ORGANIZATION_STATUS_APPROVED
from schemas.user import UserResponse
from services import event_service, organization_service
from services.notifications import event_change

log = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])
EventSortBy = Literal["date", "title", "location", "price", "added_at"]
EventSortOrder = Literal["asc", "desc"]


def _get_event_or_404_authorized(event_id: int, db_user: UserResponse) -> EventResponse:
    """Fetch event by ID (404 if missing); require creator or admin."""
    return get_authorized_resource(
        lambda: event_service.get_event(event_id),
        EVENT_NOT_FOUND,
        db_user,
    )


def _authorize_event_organization(organization_id: int, db_user: UserResponse) -> None:
    """Require management-team membership (or admin) to publish under this organization.

    Membership alone is not enough: the organization itself must have cleared
    admin review, so submitting an organization is never a route to publishing
    events without moderation. Display fields are derived server-side; this only
    enforces who may post.
    """
    organization = get_or_404(
        organization_service.get_organization(organization_id), ORGANIZATION_NOT_FOUND
    )
    if not is_admin(db_user):
        if organization.status != ORGANIZATION_STATUS_APPROVED:
            raise AuthorizationError(ORGANIZATION_PENDING_REVIEW)
        owned_organizations = organization_service.list_organizations_by_owner(str(db_user.id))
        if not any(c.id == organization.id for c in owned_organizations):
            raise AuthorizationError(ORGANIZATION_EVENT_CREATION_REQUIRED)


@router.get("/promoted", response_model=list[EventSummaryResponse])
def list_promoted_events(
    school: str | None = Query(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH),
):
    """Public list of promoted events for a school."""
    if school == "all":
        school = None
    return event_service.list_promoted_events(school=school)


@router.get("/stats", response_model=dict[str, EventStatsResponse])
def get_event_stats(school: str = Query(..., min_length=1, max_length=MAX_EVENT_SCHOOL_LENGTH)):
    """Public uncached card stats for one school, or for all of them."""
    return event_service.get_event_stats_for_school(None if school == "all" else school)


@router.get("/", response_model=EventFeedResponse)
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
    added_within_24h: bool = Query(default=False),
    ids: list[int] | None = Query(default=None),
    sort_by: EventSortBy = Query(default="date"),
    sort_order: EventSortOrder = Query(default="asc"),
    start_utc: datetime | None = Query(default=None),
    end_utc: datetime | None = Query(default=None),
    pagination: PaginationParams = Depends(),
):
    """Public school feed; optional ``start_utc``/``end_utc`` window. Omits ``created_by``."""
    if school == "all":
        school = None
    with ThreadPoolExecutor(max_workers=1) as pool:
        latest_event_future = pool.submit(event_service.get_latest_added_event, school)
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
            added_within_24h=added_within_24h,
        )
        latest_event = latest_event_future.result()

    return {
        **paginated_response(items, total, pagination),
        "latest_added_event": latest_event,
    }


@router.get("/{event_id}", response_model=EventPublicResponse)
def get_event(event_id: int):
    """Public event detail; ``created_by`` omitted via ``EventPublicResponse``."""
    return get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)


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
    # Reassigning orgs requires management-team membership (or admin), same as create.
    if data.organization_id is not None:
        _authorize_event_organization(data.organization_id, db_user)
    update_result = get_or_404(event_service.update_event(event_id, data), EVENT_NOT_FOUND)
    updated_event = update_result.event
    # Notify on material diff only (compute_event_diff); never fail the update on notify errors.
    diff = event_service.compute_event_diff(old_event, updated_event)
    if diff:
        try:
            event_change.enqueue_event_change(
                updated_event,
                diff,
                update_result.recipient_ids,
            )
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
