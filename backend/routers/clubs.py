from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_current_user
from schemas.club import ClubCreate, ClubUpdate, ClubResponse
from services import club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


@router.get("/", response_model=list[ClubResponse])
def list_clubs(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    club_type: str | None = None,
    search: str | None = None,
):
    return club_service.list_clubs(skip=skip, limit=limit, club_type=club_type, search=search)


@router.get("/{club_id}", response_model=ClubResponse)
def get_club(club_id: int):
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
    return club


@router.post("/", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
def create_club(
    data: ClubCreate,
    _=Depends(get_current_user),
):
    return club_service.create_club(data)


@router.patch("/{club_id}", response_model=ClubResponse)
def update_club(
    club_id: int,
    data: ClubUpdate,
    _=Depends(get_current_user),
):
    club = club_service.update_club(club_id, data)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
    return club


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_club(
    club_id: int,
    _=Depends(get_current_user),
):
    deleted = club_service.delete_club(club_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
