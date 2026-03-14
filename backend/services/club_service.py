from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from models.club import Club
from schemas.club import ClubCreate, ClubUpdate


async def get_club(db: AsyncSession, club_id: int) -> Club | None:
    result = await db.execute(select(Club).where(Club.id == club_id))
    return result.scalar_one_or_none()


async def list_clubs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    club_type: str | None = None,
    search: str | None = None,
) -> list[Club]:
    query = select(Club)

    if club_type:
        query = query.where(Club.club_type == club_type)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(Club.club_name.ilike(term))
        )

    query = query.order_by(Club.club_name).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_club(db: AsyncSession, data: ClubCreate) -> Club:
    club = Club(**data.model_dump())
    db.add(club)
    await db.commit()
    await db.refresh(club)
    return club


async def update_club(db: AsyncSession, club_id: int, data: ClubUpdate) -> Club | None:
    club = await get_club(db, club_id)
    if not club:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(club, key, value)
    await db.commit()
    await db.refresh(club)
    return club


async def delete_club(db: AsyncSession, club_id: int) -> bool:
    club = await get_club(db, club_id)
    if not club:
        return False
    await db.delete(club)
    await db.commit()
    return True
