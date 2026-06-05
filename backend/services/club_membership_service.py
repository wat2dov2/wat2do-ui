import logging
from datetime import datetime, timezone
from uuid import UUID

from core.database import get_sb
from core.tables import CLUB_MEMBERSHIPS
from schemas.club_membership import ClubMembershipResponse, ClubMembershipWithUserResponse

log = logging.getLogger(__name__)


def create_membership_request(club_id: int, user_id: UUID) -> ClubMembershipResponse:
    """Create a new membership request or reset an existing rejected one to pending."""
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "club_id": club_id,
        "user_id": str(user_id),
        "status": "pending",
        "role": "member",
        "updated_at": now,
    }
    r = get_sb().table(CLUB_MEMBERSHIPS).upsert(payload, on_conflict="club_id,user_id").execute()
    return ClubMembershipResponse.model_validate(r.data[0])


def delete_membership(club_id: int, user_id: UUID) -> bool:
    """Delete a club membership or request (leaving or cancelling request)."""
    r = (
        get_sb()
        .table(CLUB_MEMBERSHIPS)
        .delete()
        .eq("club_id", club_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(r.data)


def get_user_membership_status(club_id: int, user_id: UUID) -> ClubMembershipResponse | None:
    """Get the membership details for a specific user in a club."""
    r = (
        get_sb()
        .table(CLUB_MEMBERSHIPS)
        .select("*")
        .eq("club_id", club_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    if not r.data:
        return None
    return ClubMembershipResponse.model_validate(r.data[0])


def list_club_memberships(
    club_id: int, status: str | None = None
) -> list[ClubMembershipWithUserResponse]:
    """List memberships for a club, optionally filtered by status, including user details."""
    q = (
        get_sb()
        .table(CLUB_MEMBERSHIPS)
        .select("*, users(id, email, username, full_name, avatar_url)")
        .eq("club_id", club_id)
    )
    if status:
        q = q.eq("status", status)

    r = q.execute()

    results = []
    for item in r.data or []:
        if "users" in item:
            # Map "users" to "user" to match ClubMembershipWithUserResponse schema
            user_data = item.pop("users")
            item["user"] = user_data
            try:
                results.append(ClubMembershipWithUserResponse.model_validate(item))
            except Exception as e:
                log.error("Failed to validate membership row: %s. Error: %s", item, e)
    return results


def update_membership_status(
    club_id: int, user_id: UUID, status: str, role: str | None = None
) -> ClubMembershipResponse | None:
    """Update status (approve/reject) or role of a membership."""
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "status": status,
        "updated_at": now,
    }
    if role:
        payload["role"] = role

    r = (
        get_sb()
        .table(CLUB_MEMBERSHIPS)
        .update(payload)
        .eq("club_id", club_id)
        .eq("user_id", str(user_id))
        .execute()
    )

    if not r.data:
        return None
    return ClubMembershipResponse.model_validate(r.data[0])
