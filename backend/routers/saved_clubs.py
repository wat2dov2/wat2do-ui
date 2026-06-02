import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.constants import MAX_SAVED_CLUBS_PER_USER
from core.errors import CLUB_NOT_FOUND, SAVED_CLUBS_CAP_REACHED
from core.exceptions import NotFoundError, ValidationError
from schemas.saved_club import SaveClubStatusResponse
from services import club_service, saved_club_service

router = APIRouter(prefix="/saved-clubs", tags=["saved-clubs"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_saved_clubs(user=Depends(get_db_user)):
    """Return club IDs saved by the current user.

    - 401 if unauthenticated.
    """
    try:
        return saved_club_service.get_saved_club_ids(str(user.id))
    except APIError as e:
        log.warning("saved_clubs table unavailable: %s", e)
        return []


@router.put(
    "/{club_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveClubStatusResponse,
)
def save_club(club_id: int, user=Depends(get_db_user)):
    """Save (bookmark) a club.

    - 401 if unauthenticated.
    - 404 if the referenced club does not exist.
    - 400 if the user has already hit the ``MAX_SAVED_CLUBS_PER_USER`` cap.
    """
    if club_service.get_club(club_id) is None:
        raise NotFoundError(CLUB_NOT_FOUND)

    count = saved_club_service.count_saved_clubs(str(user.id))
    if count >= MAX_SAVED_CLUBS_PER_USER:
        raise ValidationError(SAVED_CLUBS_CAP_REACHED)

    saved_club_service.save_club(str(user.id), club_id)
    return {"status": "saved"}


@router.delete(
    "/{club_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveClubStatusResponse,
)
def unsave_club(club_id: int, user=Depends(get_db_user)):
    """Remove a saved club.

    - 401 if unauthenticated.
    """
    saved_club_service.unsave_club(str(user.id), club_id)
    return {"status": "unsaved"}
