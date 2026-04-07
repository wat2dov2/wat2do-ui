"""Events via Supabase. Sync so no asyncpg/SQLAlchemy."""

from datetime import datetime

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.tables import EVENTS
from schemas.event import EventCreate, EventUpdate, EventResponse, LatestEventResponse


def get_latest_added_event() -> LatestEventResponse | None:
    """Return the most recently added event (by added_at desc), or None if no events."""
    r = (
        get_sb()
        .table(EVENTS)
        .select("title,added_at")
        .order("added_at", desc=True)
        .limit(1)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return None
    return LatestEventResponse.model_validate(r.data[0])


def get_event(event_id: int) -> EventResponse | None:
    r = get_sb().table(EVENTS).select("*").eq("id", event_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return EventResponse.model_validate(r.data[0])


def list_events(
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    category: str | None = None,
    club_type: str | None = None,
    school: str | None = None,
    search: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    has_food: bool | None = None,
    max_price: float | None = None,
    registration: bool | None = None,
) -> list[EventResponse]:
    q = get_sb().table(EVENTS).select("*")
    if category:
        q = q.eq("category", category)
    if club_type:
        q = q.eq("club_type", club_type)
    if school:
        q = q.eq("school", school)
    if search:
        term = f"%{search}%"
        q = q.or_(f"title.ilike.{term},description.ilike.{term},location.ilike.{term},organization.ilike.{term}")
    if from_date:
        q = q.gte("dtstart_utc", from_date.isoformat())
    if to_date:
        q = q.lte("dtstart_utc", to_date.isoformat())
    if has_food is True:
        q = q.not_.is_("food", "null")
    if max_price is not None:
        q = q.or_(f"price.is.null,price.lte.{max_price}")
    if registration is not None:
        q = q.eq("registration", registration)
    q = q.order("dtstart_utc", desc=True).range(skip, skip + limit - 1)
    r = q.execute()
    return [EventResponse.model_validate(e) for e in (r.data or [])]


def create_event(data: EventCreate, *, created_by: str) -> EventResponse:
    payload = data.model_dump()
    payload["created_by"] = created_by
    r = get_sb().table(EVENTS).insert(payload).execute()
    return EventResponse.model_validate(r.data[0])


def update_event(event_id: int, data: EventUpdate) -> EventResponse | None:
    if get_event(event_id) is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    r = get_sb().table(EVENTS).update(payload).eq("id", event_id).execute()
    return EventResponse.model_validate(r.data[0]) if r.data else None


def delete_event(event_id: int) -> bool:
    r = get_sb().table(EVENTS).delete().eq("id", event_id).execute()
    return bool(r.data)
