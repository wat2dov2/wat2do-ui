"""Saved clubs: persist user bookmarks of clubs to the database."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.tables import USER_SAVED_CLUBS
from schemas.saved_club import SavedClubResponse

log = logging.getLogger(__name__)


def _get_saved_row(user_id: str, club_id: int) -> SavedClubResponse | None:
    """Return the existing ``user_saved_clubs`` row for (user_id, club_id)."""
    r = (
        get_sb()
        .table(USER_SAVED_CLUBS)
        .select("*")
        .eq("user_id", user_id)
        .eq("club_id", club_id)
        .limit(1)
        .execute()
    )
    if r.data:
        return SavedClubResponse.model_validate(r.data[0])
    return None


def save_club(user_id: str, club_id: int) -> SavedClubResponse:
    """Save a club for the user, idempotently.

    - If a row already exists for (user_id, club_id), return it as-is.
    - Otherwise insert a new row with a newly-minted UUID.
    """
    existing = _get_saved_row(user_id, club_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "club_id": club_id,
    }
    r = get_sb().table(USER_SAVED_CLUBS).insert(payload).execute()
    if r.data:
        return SavedClubResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for save_club(user_id=%s, club_id=%s), using payload fallback",
        user_id,
        club_id,
    )
    return SavedClubResponse(**payload, saved_at=datetime.now(timezone.utc))
