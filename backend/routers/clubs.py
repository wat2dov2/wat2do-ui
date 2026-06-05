from typing import Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_admin_user, get_current_user, get_db_user
from core.constants import (
    DEFAULT_LIST_LIMIT,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_LIST_LIMIT,
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    ROLE_ADMIN,
)
from core.errors import CLUB_NOT_FOUND, NOT_AUTHORIZED
from core.exceptions import AuthorizationError, NotFoundError, ValidationError, get_or_404
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubIntegrationUpdate,
    ClubMemberAdd,
    ClubMemberResponse,
    ClubResponse,
    ClubUpdate,
    DiscordIntegrationOptionsResponse,
    IntegrationPlatform,
    PlatformIntegrationOptionsResponse,
)
from schemas.club_membership import (
    ClubMembershipResponse,
    ClubMembershipUpdate,
    ClubMembershipWithUserResponse,
)
from schemas.invitation import (
    ClubInvitationCreate,
    ClubInvitationPublicResponse,
    ClubInvitationResponse,
)
from schemas.user import UserResponse
from services import club_membership_service, club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


INTEGRATION_NOT_FOUND = "Integration not found"


def _get_club_or_403(club_id: int, db_user: UserResponse) -> ClubResponse:
    """Fetch a club by ID (404 if missing) and verify the user is its member or an admin (403 if not)."""
    club = club_service.get_club(club_id)
    if club is None:
        raise NotFoundError(CLUB_NOT_FOUND)

    if db_user.role == ROLE_ADMIN:
        return club

    if club_service.is_club_member(club_id, str(db_user.id)):
        return club

    raise AuthorizationError(NOT_AUTHORIZED)


def _authorize_and_exec(club_id: int, db_user: UserResponse, action):
    """Verify club ownership, execute *action*, and validate the result.

    Separates the authorization check from the action so callers are
    explicit about what operation is being performed.
    """
    _get_club_or_403(club_id, db_user)
    return get_or_404(action(), INTEGRATION_NOT_FOUND)


@router.get("/", response_model=list[ClubResponse])
def list_clubs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    club_type: str | None = Query(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
):
    return club_service.list_clubs(
        skip=skip, limit=limit, club_type=club_type, school=school, search=search
    )


@router.get("/mine", response_model=list[ClubResponse])
def list_my_clubs(db_user: UserResponse = Depends(get_db_user)):
    """Return clubs owned by the authenticated user."""
    return club_service.list_clubs_by_owner(str(db_user.id))


@router.get(
    "/integrations/discord/options",
    response_model=DiscordIntegrationOptionsResponse,
)
def get_discord_options(_=Depends(get_current_user)):
    return club_service.get_discord_options()


@router.get(
    "/integrations/{platform}/options",
    response_model=PlatformIntegrationOptionsResponse,
)
def get_platform_options(
    platform: IntegrationPlatform,
    _=Depends(get_current_user),
):
    return club_service.get_integration_options(platform)


@router.get("/{club_id}", response_model=ClubResponse)
def get_club(club_id: int):
    return get_or_404(club_service.get_club(club_id), CLUB_NOT_FOUND)


@router.get(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def get_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        club_id,
        db_user,
        lambda: club_service.get_platform_integration(club_id, platform),
    )


@router.put(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def upsert_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    data: ClubIntegrationUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        club_id,
        db_user,
        lambda: club_service.upsert_platform_integration(
            club_id=club_id,
            platform=platform,
            name=data.name,
            metadata=data.metadata,
        ),
    )


@router.delete(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def disconnect_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        club_id,
        db_user,
        lambda: club_service.disconnect_platform_integration(club_id, platform),
    )


@router.post("/", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
def create_club(
    data: ClubCreate,
    admin: UserResponse = Depends(get_admin_user),
):
    owner_id = data.owner_user_id or admin.id
    return club_service.create_club(data, created_by=str(owner_id))


@router.patch("/{club_id}", response_model=ClubResponse)
def update_club(
    club_id: int,
    data: ClubUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_club_or_403(club_id, db_user)
    updated = club_service.update_club(club_id, data)
    return updated


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_club(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_club_or_403(club_id, db_user)
    club_service.delete_club(club_id)


@router.get("/{club_id}/members", response_model=list[ClubMemberResponse])
def list_club_members(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    """List all members of a club. Admin or club members only."""
    _get_club_or_403(club_id, db_user)
    return club_service.list_club_members(club_id)


@router.post(
    "/{club_id}/members",
    response_model=Union[ClubMemberResponse, ClubInvitationResponse],
    status_code=status.HTTP_201_CREATED,
)
def add_club_member(
    club_id: int,
    data: ClubMemberAdd,
    db_user: UserResponse = Depends(get_db_user),
):
    """Add a member to the club by email. Admin or club members only.

    If the user already has an account, they are added directly.
    Otherwise, a pending invitation is created and sent.
    """
    _get_club_or_403(club_id, db_user)

    from services import user_service

    target_user = user_service.get_user_by_email(data.email)
    if not target_user:
        return club_service.create_invitation(club_id, data.email, db_user.id)

    return club_service.add_club_member(club_id, target_user.id)


@router.delete("/{club_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_club_member(
    club_id: int,
    user_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    """Remove a member from the club. Admin or club members only."""
    _get_club_or_403(club_id, db_user)

    from uuid import UUID

    try:
        uuid_user_id = UUID(user_id)
    except ValueError:
        raise ValidationError("Invalid user ID format")

    success = club_service.remove_club_member(club_id, uuid_user_id)
    if not success:
        raise NotFoundError("Member not found in this club")


@router.post(
    "/{club_id}/invitations",
    response_model=ClubInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    club_id: int,
    data: ClubInvitationCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    """Explicitly create and send an invitation."""
    _get_club_or_403(club_id, db_user)
    return club_service.create_invitation(club_id, data.email, db_user.id)


@router.get("/{club_id}/invitations", response_model=list[ClubInvitationResponse])
def list_invitations(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    """List pending invitations for the club."""
    _get_club_or_403(club_id, db_user)
    return club_service.list_invitations(club_id)


@router.delete("/{club_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    club_id: int,
    invitation_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    """Revoke/delete an invitation."""
    _get_club_or_403(club_id, db_user)
    success = club_service.revoke_invitation(club_id, invitation_id)
    if not success:
        raise NotFoundError("Invitation not found")


@router.get("/invitations/{token}", response_model=ClubInvitationPublicResponse)
def get_invitation_by_token(token: str):
    """Public route to validate an invitation token and fetch public details (club name)."""
    return club_service.get_invitation_by_token(token)


@router.post("/invitations/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(
    token: str,
    db_user: UserResponse = Depends(get_db_user),
):
    """Accept an invitation token using the logged-in user's identity."""
    success = club_service.accept_invitation(token, db_user.id)
    if not success:
        raise NotFoundError("Invitation not found or has expired")


# --- Club Memberships & Requests Endpoints (Student Join Requests) ---


@router.post(
    "/{club_id}/join", response_model=ClubMembershipResponse, status_code=status.HTTP_201_CREATED
)
def request_to_join_club(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    """Create a pending request to join the club."""
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=404, detail=CLUB_NOT_FOUND)
    return club_membership_service.create_membership_request(club_id, db_user.id)


@router.delete("/{club_id}/membership", status_code=status.HTTP_204_NO_CONTENT)
def leave_club_or_cancel_request(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    """Leave a club or cancel a pending join request."""
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=404, detail=CLUB_NOT_FOUND)
    success = club_membership_service.delete_membership(club_id, db_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Membership not found")


@router.get("/{club_id}/membership", response_model=ClubMembershipResponse | None)
def get_my_membership_status(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    """Get the current user's membership details for this club."""
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=404, detail=CLUB_NOT_FOUND)
    return club_membership_service.get_user_membership_status(club_id, db_user.id)


@router.get("/{club_id}/memberships", response_model=list[ClubMembershipWithUserResponse])
def list_club_memberships(
    club_id: int,
    status: str | None = Query(default=None),
    db_user: UserResponse = Depends(get_db_user),
):
    """Club Admin/Owner: List student memberships and pending requests for the club."""
    _get_club_or_403(club_id, db_user)
    return club_membership_service.list_club_memberships(club_id, status=status)


@router.patch("/{club_id}/memberships/{user_id}", response_model=ClubMembershipResponse)
def update_club_membership(
    club_id: int,
    user_id: UUID,
    data: ClubMembershipUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    """Club Admin/Owner: Approve/reject a request or change role of a student member."""
    _get_club_or_403(club_id, db_user)
    updated = club_membership_service.update_membership_status(
        club_id=club_id,
        user_id=user_id,
        status=data.status,
        role=data.role,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    return updated


@router.delete("/{club_id}/memberships/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_club_membership(
    club_id: int,
    user_id: UUID,
    db_user: UserResponse = Depends(get_db_user),
):
    """Club Admin/Owner: Remove a student member or request from the club roster."""
    _get_club_or_403(club_id, db_user)
    success = club_membership_service.delete_membership(club_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Membership not found")
