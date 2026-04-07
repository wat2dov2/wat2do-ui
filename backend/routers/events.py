from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_current_user, require_owner_or_admin
from schemas.event import EventCreate, EventUpdate, EventResponse, LatestEventResponse
from services import event_service

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/latest-added", response_model=LatestEventResponse | None)
def get_latest_added():
    """Return the most recently added event (title + added_at) for UI text like 'X added 22 minutes ago'."""
    return event_service.get_latest_added_event()


@router.get("/", response_model=list[EventResponse])
def list_events(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    category: str | None = None,
    club_type: str | None = None,
    school: str | None = None,
    search: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    has_food: bool | None = None,
    max_price: float | None = None,
    registration: bool | None = None,
):
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
    )


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int):
    event = event_service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate,
    auth_user: dict = Depends(get_current_user),
):
    return event_service.create_event(data, created_by=auth_user["id"])


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    data: EventUpdate,
    auth_user: dict = Depends(get_current_user),
):
    event = event_service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    require_owner_or_admin(auth_user, event.created_by)
    updated = event_service.update_event(event_id, data)
    return updated


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    auth_user: dict = Depends(get_current_user),
):
    event = event_service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    require_owner_or_admin(auth_user, event.created_by)
    event_service.delete_event(event_id)
