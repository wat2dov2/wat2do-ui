from typing import Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_admin_user, get_current_user, get_db_user
from core.constants import (
    MAX_EVENT_ORGANIZATION_TYPE_LENGTH,
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    ROLE_ADMIN,
)
from core.errors import NOT_AUTHORIZED, ORGANIZATION_NOT_FOUND
from core.exceptions import AuthorizationError, NotFoundError, ValidationError, get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.claim import (
    OrganizationClaimCreate,
    OrganizationClaimResponse,
    OrganizationClaimUpdate,
)
from schemas.invitation import (
    OrganizationInvitationCreate,
    OrganizationInvitationPublicResponse,
    OrganizationInvitationResponse,
)
from schemas.join_request import (
    OrganizationJoinRequestCreate,
    OrganizationJoinRequestResponse,
    OrganizationJoinRequestUpdate,
)
from schemas.organization import (
    DiscordIntegrationOptionsResponse,
    IntegrationPlatform,
    OrganizationCreate,
    OrganizationIntegrationResponse,
    OrganizationIntegrationUpdate,
    OrganizationMemberAdd,
    OrganizationMemberResponse,
    OrganizationResponse,
    OrganizationUpdate,
    PlatformIntegrationOptionsResponse,
)
from schemas.organization_membership import (
    OrganizationMembershipResponse,
    OrganizationMembershipUpdate,
    OrganizationMembershipWithUserResponse,
)
from schemas.user import UserResponse
from services import organization_membership_service, organization_service

router = APIRouter(prefix="/organizations", tags=["organizations"])


INTEGRATION_NOT_FOUND = "Integration not found"


def _get_organization_or_403(organization_id: int, db_user: UserResponse) -> OrganizationResponse:
    """Fetch organization by ID (404 if missing); require organization_members membership or admin."""
    organization = organization_service.get_organization(organization_id)
    if organization is None:
        raise NotFoundError(ORGANIZATION_NOT_FOUND)

    if db_user.role == ROLE_ADMIN:
        return organization

    if organization_service.is_organization_member(organization_id, str(db_user.id)):
        return organization

    raise AuthorizationError(NOT_AUTHORIZED)


def _authorize_and_exec(organization_id: int, db_user: UserResponse, action):
    """Require membership (or admin), run *action*, and 404 if the result is missing."""
    _get_organization_or_403(organization_id, db_user)
    return get_or_404(action(), INTEGRATION_NOT_FOUND)


@router.get("/", response_model=PaginatedResponse[OrganizationResponse])
def list_organizations(
    organization_type: str | None = Query(
        default=None, max_length=MAX_EVENT_ORGANIZATION_TYPE_LENGTH
    ),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    categories: list[str] | None = Query(default=None),
    ids: list[int] | None = Query(default=None),
    pagination: PaginationParams = Depends(),
):
    if school == "all":
        school = None
    items, total = organization_service.list_organizations(
        skip=pagination.offset,
        limit=pagination.page_size,
        organization_type=organization_type,
        school=school,
        search=search,
        categories=categories,
        ids=ids,
    )
    return paginated_response(items, total, pagination)


@router.get("/mine", response_model=list[OrganizationResponse])
def list_my_organizations(db_user: UserResponse = Depends(get_db_user)):
    return organization_service.list_organizations_by_owner(str(db_user.id))


@router.get(
    "/integrations/discord/options",
    response_model=DiscordIntegrationOptionsResponse,
)
def get_discord_options(_=Depends(get_current_user)):
    return organization_service.get_discord_options()


@router.get(
    "/integrations/{platform}/options",
    response_model=PlatformIntegrationOptionsResponse,
)
def get_platform_options(
    platform: IntegrationPlatform,
    _=Depends(get_current_user),
):
    return organization_service.get_integration_options(platform)


@router.get("/claims", response_model=list[OrganizationClaimResponse])
def list_claims(
    status: str | None = Query(default=None),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    _: UserResponse = Depends(get_admin_user),
):
    if school == "all":
        school = None
    return organization_service.list_claims(status=status, school=school)


@router.get("/{organization_id}", response_model=OrganizationResponse)
def get_organization(organization_id: int):
    return get_or_404(
        organization_service.get_organization(organization_id), ORGANIZATION_NOT_FOUND
    )


@router.get(
    "/{organization_id}/integrations/{platform}",
    response_model=OrganizationIntegrationResponse,
)
def get_platform_integration(
    organization_id: int,
    platform: IntegrationPlatform,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        organization_id,
        db_user,
        lambda: organization_service.get_platform_integration(organization_id, platform),
    )


@router.put(
    "/{organization_id}/integrations/{platform}",
    response_model=OrganizationIntegrationResponse,
)
def upsert_platform_integration(
    organization_id: int,
    platform: IntegrationPlatform,
    data: OrganizationIntegrationUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        organization_id,
        db_user,
        lambda: organization_service.upsert_platform_integration(
            organization_id=organization_id,
            platform=platform,
            name=data.name,
            metadata=data.metadata,
        ),
    )


@router.delete(
    "/{organization_id}/integrations/{platform}",
    response_model=OrganizationIntegrationResponse,
)
def disconnect_platform_integration(
    organization_id: int,
    platform: IntegrationPlatform,
    db_user: UserResponse = Depends(get_db_user),
):
    return _authorize_and_exec(
        organization_id,
        db_user,
        lambda: organization_service.disconnect_platform_integration(organization_id, platform),
    )


@router.post("/", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_organization(
    data: OrganizationCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    return organization_service.create_organization(data, created_by=str(db_user.id))


@router.patch("/{organization_id}", response_model=OrganizationResponse)
def update_organization(
    organization_id: int,
    data: OrganizationUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    updated = organization_service.update_organization(organization_id, data)
    return updated


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    organization_service.delete_organization(organization_id)


@router.get("/{organization_id}/members", response_model=list[OrganizationMemberResponse])
def list_organization_members(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_service.list_organization_members(organization_id)


@router.post(
    "/{organization_id}/members",
    response_model=Union[OrganizationMemberResponse, OrganizationInvitationResponse],
    status_code=status.HTTP_201_CREATED,
)
def add_organization_member(
    organization_id: int,
    data: OrganizationMemberAdd,
    db_user: UserResponse = Depends(get_db_user),
):
    """Add by email: existing users join organization_members directly; otherwise invite."""
    _get_organization_or_403(organization_id, db_user)

    from services import user_service

    target_user = user_service.get_user_by_email(data.email)
    if not target_user:
        return organization_service.create_invitation(organization_id, data.email, db_user.id)

    return organization_service.add_organization_member(organization_id, target_user.id)


@router.delete("/{organization_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_organization_member(
    organization_id: int,
    user_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)

    from uuid import UUID

    try:
        uuid_user_id = UUID(user_id)
    except ValueError:
        raise ValidationError("Invalid user ID format")

    success = organization_service.remove_organization_member(organization_id, uuid_user_id)
    if not success:
        raise NotFoundError("Member not found in this organization")


@router.post(
    "/{organization_id}/invitations",
    response_model=OrganizationInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    organization_id: int,
    data: OrganizationInvitationCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_service.create_invitation(organization_id, data.email, db_user.id)


@router.get("/{organization_id}/invitations", response_model=list[OrganizationInvitationResponse])
def list_invitations(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_service.list_invitations(organization_id)


@router.delete(
    "/{organization_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT
)
def revoke_invitation(
    organization_id: int,
    invitation_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    success = organization_service.revoke_invitation(organization_id, invitation_id)
    if not success:
        raise NotFoundError("Invitation not found")


@router.get("/invitations/{token}", response_model=OrganizationInvitationPublicResponse)
def get_invitation_by_token(token: str):
    """Public: validate invitation token and return public details (organization name)."""
    return organization_service.get_invitation_by_token(token)


@router.post("/invitations/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(
    token: str,
    db_user: UserResponse = Depends(get_db_user),
):
    success = organization_service.accept_invitation(token, db_user.id)
    if not success:
        raise NotFoundError("Invitation not found or has expired")


@router.post(
    "/{organization_id}/join",
    response_model=OrganizationMembershipResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_to_join_organization(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    organization = organization_service.get_organization(organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail=ORGANIZATION_NOT_FOUND)
    return organization_membership_service.create_membership_request(organization_id, db_user.id)


@router.delete("/{organization_id}/membership", status_code=status.HTTP_204_NO_CONTENT)
def leave_organization_or_cancel_request(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    organization = organization_service.get_organization(organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail=ORGANIZATION_NOT_FOUND)
    success = organization_membership_service.delete_membership(organization_id, db_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Membership not found")


@router.get("/{organization_id}/membership", response_model=OrganizationMembershipResponse | None)
def get_my_membership_status(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    organization = organization_service.get_organization(organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail=ORGANIZATION_NOT_FOUND)
    return organization_membership_service.get_user_membership_status(organization_id, db_user.id)


@router.get(
    "/{organization_id}/memberships", response_model=list[OrganizationMembershipWithUserResponse]
)
def list_organization_memberships(
    organization_id: int,
    status: str | None = Query(default=None),
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_membership_service.list_organization_memberships(
        organization_id, status=status
    )


@router.patch(
    "/{organization_id}/memberships/{user_id}", response_model=OrganizationMembershipResponse
)
def update_organization_membership(
    organization_id: int,
    user_id: UUID,
    data: OrganizationMembershipUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    updated = organization_membership_service.update_membership_status(
        organization_id=organization_id,
        user_id=user_id,
        status=data.status,
        role=data.role,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    return updated


@router.delete("/{organization_id}/memberships/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_organization_membership(
    organization_id: int,
    user_id: UUID,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    success = organization_membership_service.delete_membership(organization_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Membership not found")


@router.post(
    "/{organization_id}/claims",
    response_model=OrganizationClaimResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_claim(
    organization_id: int,
    data: OrganizationClaimCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    return organization_service.create_claim(
        organization_id, db_user.id, data.executive_role, data.proof_url
    )


@router.patch("/claims/{claim_id}", response_model=OrganizationClaimResponse)
def update_claim(
    claim_id: UUID,
    data: OrganizationClaimUpdate,
    _: UserResponse = Depends(get_admin_user),
):
    return organization_service.update_claim(claim_id, data.status, data.rejection_reason)


@router.post(
    "/{organization_id}/join-requests",
    response_model=OrganizationJoinRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_join_request(
    organization_id: int,
    data: OrganizationJoinRequestCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    """Request to join the organization's management team (organization_members)."""
    return organization_service.create_join_request(organization_id, db_user.id, data.pitch)


@router.get(
    "/{organization_id}/join-requests", response_model=list[OrganizationJoinRequestResponse]
)
def list_join_requests(
    organization_id: int,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_service.list_join_requests(organization_id)


@router.patch(
    "/{organization_id}/join-requests/{request_id}", response_model=OrganizationJoinRequestResponse
)
def update_join_request(
    organization_id: int,
    request_id: UUID,
    data: OrganizationJoinRequestUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_organization_or_403(organization_id, db_user)
    return organization_service.update_join_request(request_id, data.status)
