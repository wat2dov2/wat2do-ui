from typing import Union
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_current_user, get_db_user, is_admin
from core.constants import (
    MAX_CLUB_TYPE_LENGTH,
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    ROLE_ADMIN,
)
from core.errors import CLUB_NOT_FOUND, NOT_AUTHORIZED
from core.exceptions import AuthorizationError, NotFoundError, ValidationError, get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.claim import (
    ClubClaimCreate,
    ClubClaimResponse,
    ClubClaimUpdate,
)
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubIntegrationUpdate,
    ClubMemberAdd,
    ClubMemberResponse,
    ClubResponse,
    ClubStatus,
    ClubUpdate,
    DiscordIntegrationOptionsResponse,
    IntegrationPlatform,
    PlatformIntegrationOptionsResponse,
)
from schemas.invitation import (
    ClubInvitationCreate,
    ClubInvitationPublicResponse,
    ClubInvitationResponse,
)
from schemas.user import UserResponse
from services import club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


INTEGRATION_NOT_FOUND = "Integration not found"


def _get_club_or_403(club_id: int, db_user: UserResponse) -> ClubResponse:
    """Fetch club by ID (404 if missing); require club_members membership or admin."""
    club = club_service.get_club(club_id)
    if club is None:
        raise NotFoundError(CLUB_NOT_FOUND)

    if db_user.role == ROLE_ADMIN:
        return club

    if club_service.is_club_member(club_id, str(db_user.id)):
        return club

    raise AuthorizationError(NOT_AUTHORIZED)


def _authorize_and_exec(club_id: int, db_user: UserResponse, action):
    """Require membership (or admin), run *action*, and 404 if the result is missing."""
    _get_club_or_403(club_id, db_user)
    return get_or_404(action(), INTEGRATION_NOT_FOUND)


@router.get("/", response_model=PaginatedResponse[ClubResponse])
def list_clubs(
    club_type: str | None = Query(
        default=None,
        min_length=1,
        max_length=MAX_CLUB_TYPE_LENGTH,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    categories: list[str] | None = Query(default=None),
    ids: list[int] | None = Query(default=None),
    min_events: int = Query(default=0, ge=0),
    pagination: PaginationParams = Depends(),
):
    """Public directory. Only approved clubs are listed."""
    items, total = club_service.list_clubs(
        skip=pagination.offset,
        limit=pagination.page_size,
        club_type=club_type,
        school=school,
        search=search,
        categories=categories,
        ids=ids,
        min_events=min_events,
    )
    return paginated_response(items, total, pagination)


@router.get("/review", response_model=PaginatedResponse[ClubResponse])
def list_clubs_for_review(
    club_status: ClubStatus | None = Query(default=None),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    """Admin review queue across every review state."""
    items, total = club_service.list_club_submissions(
        offset=pagination.offset,
        limit=pagination.page_size,
        school=school,
        search=search,
        status=club_status,
    )
    return paginated_response(items, total, pagination)


@router.get("/mine", response_model=list[ClubResponse])
def list_my_clubs(db_user: UserResponse = Depends(get_db_user)):
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


@router.get("/claims", response_model=PaginatedResponse[ClubClaimResponse])
def list_claims(
    status: str | None = Query(default=None),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = club_service.list_claims(
        status=status,
        school=school,
        search=search,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


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
    db_user: UserResponse = Depends(get_db_user),
):
    """Anyone signed in may submit a club; only admins publish directly."""
    return club_service.create_club(
        data, created_by=str(db_user.id), auto_approve=is_admin(db_user)
    )


@router.post("/{club_id}/review", response_model=ClubResponse)
def review_club(
    club_id: int,
    club_status: ClubStatus,
    _: UserResponse = Depends(get_admin_user),
):
    """Approve or reject a submitted club."""
    return get_or_404(
        club_service.set_club_status(club_id, club_status),
        CLUB_NOT_FOUND,
    )


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
    """Add by email: existing users join club_members directly; otherwise invite."""
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
    _get_club_or_403(club_id, db_user)
    return club_service.create_invitation(club_id, data.email, db_user.id)


@router.get("/{club_id}/invitations", response_model=list[ClubInvitationResponse])
def list_invitations(
    club_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_club_or_403(club_id, db_user)
    return club_service.list_invitations(club_id)


@router.delete("/{club_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    club_id: int,
    invitation_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_club_or_403(club_id, db_user)
    success = club_service.revoke_invitation(club_id, invitation_id)
    if not success:
        raise NotFoundError("Invitation not found")


@router.get("/invitations/{token}", response_model=ClubInvitationPublicResponse)
def get_invitation_by_token(token: str):
    """Public: validate invitation token and return public details (club name)."""
    return club_service.get_invitation_by_token(token)


@router.post("/invitations/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(
    token: str,
    db_user: UserResponse = Depends(get_db_user),
):
    success = club_service.accept_invitation(token, db_user.id)
    if not success:
        raise NotFoundError("Invitation not found or has expired")


@router.post(
    "/{club_id}/claims",
    response_model=ClubClaimResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_claim(
    club_id: int,
    data: ClubClaimCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    return club_service.create_claim(club_id, db_user.id, data.executive_role, data.proof_url)


@router.patch("/claims/{claim_id}", response_model=ClubClaimResponse)
def update_claim(
    claim_id: UUID,
    data: ClubClaimUpdate,
    _: UserResponse = Depends(get_admin_user),
):
    return club_service.update_claim(claim_id, data.status, data.rejection_reason)
