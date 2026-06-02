"""Saved clubs: persist user bookmarks of clubs to Supabase."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_SAVED_CLUBS
from schemas.saved_club import SavedClubResponse

log = logging.getLogger(__name__)


def get_saved_club_ids(user_id: str) -> list[int]:
    """Return club IDs saved by this user."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_SAVED_CLUBS)
                .select("club_id")
                .eq("user_id", user_id)
                .order("saved_at", desc=True)
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    )
    return [row["club_id"] for row in rows]


def count_saved_clubs(user_id: str) -> int:
    """Return the total number of clubs this user has saved.

    Used by the save endpoint to enforce ``MAX_SAVED_CLUBS_PER_USER``
    without materialising the full list.
    """
    r = (
        get_sb()
        .table(USER_SAVED_CLUBS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


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


def unsave_club(user_id: str, club_id: int) -> bool:
    """Remove a saved club. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(USER_SAVED_CLUBS)
        .delete()
        .eq("user_id", user_id)
        .eq("club_id", club_id)
        .execute()
    )
    return bool(r.data)
