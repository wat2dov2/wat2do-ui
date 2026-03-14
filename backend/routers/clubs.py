from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import get_current_user
from core.database import get_db
from schemas.club import ClubCreate, ClubUpdate, ClubResponse
from services import club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


@router.get("/", response_model=list[ClubResponse])
async def list_clubs(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    club_type: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List clubs with optional filters. Public endpoint."""
    return await club_service.list_clubs(
        db, skip=skip, limit=limit, club_type=club_type, search=search
    )


@router.get("/{club_id}", response_model=ClubResponse)
async def get_club(club_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single club by ID. Public endpoint."""
    club = await club_service.get_club(db, club_id)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
    return club


@router.post("/", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
async def create_club(
    data: ClubCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Create a new club. Requires authentication."""
    return await club_service.create_club(db, data)


@router.patch("/{club_id}", response_model=ClubResponse)
async def update_club(
    club_id: int,
    data: ClubUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Update a club. Requires authentication."""
    club = await club_service.update_club(db, club_id, data)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
    return club


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_club(
    club_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Delete a club. Requires authentication."""
    deleted = await club_service.delete_club(db, club_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
