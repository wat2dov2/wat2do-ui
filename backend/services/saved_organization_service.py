"""Saved organizations: persist user bookmarks of organizations to Supabase."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_SAVED_ORGANIZATIONS
from schemas.saved_organization import SavedOrganizationResponse

log = logging.getLogger(__name__)


def get_saved_organization_ids(user_id: str) -> list[int]:
    """Return organization IDs saved by this user."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_SAVED_ORGANIZATIONS)
                .select("organization_id")
                .eq("user_id", user_id)
                .order("saved_at", desc=True)
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    )
    return [row["organization_id"] for row in rows]


def count_saved_organizations(user_id: str) -> int:
    """Return the total number of organizations this user has saved.

    Used by the save endpoint to enforce ``MAX_SAVED_ORGANIZATIONS_PER_USER``
    without materialising the full list.
    """
    r = (
        get_sb()
        .table(USER_SAVED_ORGANIZATIONS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def _get_saved_row(user_id: str, organization_id: int) -> SavedOrganizationResponse | None:
    """Return the existing ``user_saved_organizations`` row for (user_id, organization_id)."""
    r = (
        get_sb()
        .table(USER_SAVED_ORGANIZATIONS)
        .select("*")
        .eq("user_id", user_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if r.data:
        return SavedOrganizationResponse.model_validate(r.data[0])
    return None


def save_organization(user_id: str, organization_id: int) -> SavedOrganizationResponse:
    """Save a organization for the user, idempotently.

    - If a row already exists for (user_id, organization_id), return it as-is.
    - Otherwise insert a new row with a newly-minted UUID.
    """
    existing = _get_saved_row(user_id, organization_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "organization_id": organization_id,
    }
    r = get_sb().table(USER_SAVED_ORGANIZATIONS).insert(payload).execute()
    if r.data:
        return SavedOrganizationResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for save_organization(user_id=%s, organization_id=%s), using payload fallback",
        user_id,
        organization_id,
    )
    return SavedOrganizationResponse(**payload, saved_at=datetime.now(timezone.utc))


def unsave_organization(user_id: str, organization_id: int) -> bool:
    """Remove a saved organization. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(USER_SAVED_ORGANIZATIONS)
        .delete()
        .eq("user_id", user_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return bool(r.data)
