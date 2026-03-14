from datetime import datetime

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.event import Event
from schemas.event import EventCreate, EventUpdate


async def get_event(db: AsyncSession, event_id: int) -> Event | None:
    result = await db.execute(select(Event).where(Event.id == event_id))
    return result.scalar_one_or_none()


async def list_events(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    category: str | None = None,
    club_type: str | None = None,
    school: str | None = None,
    search: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    has_food: bool | None = None,
    max_price: float | None = None,
    registration: bool | None = None,
) -> list[Event]:
    query = select(Event)

    if category:
        query = query.where(Event.category == category)
    if club_type:
        query = query.where(Event.club_type == club_type)
    if school:
        query = query.where(Event.school == school)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(
                Event.title.ilike(term),
                Event.description.ilike(term),
                Event.location.ilike(term),
                Event.organization.ilike(term),
            )
        )
    if from_date:
        query = query.where(Event.dtstart_utc >= from_date)
    if to_date:
        query = query.where(Event.dtstart_utc <= to_date)
    if has_food is True:
        query = query.where(Event.food.isnot(None), func.jsonb_array_length(Event.food) > 0)
    if max_price is not None:
        query = query.where(or_(Event.price.is_(None), Event.price <= max_price))
    if registration is not None:
        query = query.where(Event.registration == registration)

    query = query.order_by(Event.dtstart_utc.desc().nullslast()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_event(db: AsyncSession, data: EventCreate) -> Event:
    event = Event(**data.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def update_event(db: AsyncSession, event_id: int, data: EventUpdate) -> Event | None:
    event = await get_event(db, event_id)
    if not event:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, event_id: int) -> bool:
    event = await get_event(db, event_id)
    if not event:
        return False
    await db.delete(event)
    await db.commit()
    return True
