import logging
from datetime import datetime, timezone
from uuid import UUID

from core.database import get_sb
from core.tables import ORGANIZATION_MEMBERSHIPS
from schemas.organization_membership import (
    OrganizationMembershipResponse,
    OrganizationMembershipWithUserResponse,
)

log = logging.getLogger(__name__)


def create_membership_request(
    organization_id: int, user_id: UUID
) -> OrganizationMembershipResponse:
    """Create a new membership request or reset an existing rejected one to pending."""
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "organization_id": organization_id,
        "user_id": str(user_id),
        "status": "pending",
        "role": "member",
        "updated_at": now,
    }
    r = (
        get_sb()
        .table(ORGANIZATION_MEMBERSHIPS)
        .upsert(payload, on_conflict="organization_id,user_id")
        .execute()
    )
    return OrganizationMembershipResponse.model_validate(r.data[0])


def delete_membership(organization_id: int, user_id: UUID) -> bool:
    """Delete a organization membership or request (leaving or cancelling request)."""
    r = (
        get_sb()
        .table(ORGANIZATION_MEMBERSHIPS)
        .delete()
        .eq("organization_id", organization_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(r.data)


def get_user_membership_status(
    organization_id: int, user_id: UUID
) -> OrganizationMembershipResponse | None:
    """Get the membership details for a specific user in a organization."""
    r = (
        get_sb()
        .table(ORGANIZATION_MEMBERSHIPS)
        .select("*")
        .eq("organization_id", organization_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    if not r.data:
        return None
    return OrganizationMembershipResponse.model_validate(r.data[0])


def list_organization_memberships(
    organization_id: int, status: str | None = None
) -> list[OrganizationMembershipWithUserResponse]:
    """List memberships for a organization, optionally filtered by status, including user details."""
    q = (
        get_sb()
        .table(ORGANIZATION_MEMBERSHIPS)
        .select("*, users(id, email, full_name, avatar_url)")
        .eq("organization_id", organization_id)
    )
    if status:
        q = q.eq("status", status)

    r = q.execute()

    results = []
    for item in r.data or []:
        if "users" in item:
            # Map "users" to "user" to match OrganizationMembershipWithUserResponse schema
            user_data = item.pop("users")
            item["user"] = user_data
            try:
                results.append(OrganizationMembershipWithUserResponse.model_validate(item))
            except Exception as e:
                log.error("Failed to validate membership row: %s. Error: %s", item, e)
    return results


def update_membership_status(
    organization_id: int, user_id: UUID, status: str, role: str | None = None
) -> OrganizationMembershipResponse | None:
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
        .table(ORGANIZATION_MEMBERSHIPS)
        .update(payload)
        .eq("organization_id", organization_id)
        .eq("user_id", str(user_id))
        .execute()
    )

    if not r.data:
        return None
    return OrganizationMembershipResponse.model_validate(r.data[0])
