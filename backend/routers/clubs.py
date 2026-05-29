from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_authorized_resource, get_current_user, get_db_user
from core.constants import (
    DEFAULT_LIST_LIMIT,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_LIST_LIMIT,
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
)
from core.errors import CLUB_NOT_FOUND
from core.exceptions import get_or_404
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubIntegrationUpdate,
    ClubResponse,
    ClubUpdate,
    DiscordIntegrationOptionsResponse,
    IntegrationPlatform,
    PlatformIntegrationOptionsResponse,
)
from schemas.user import UserResponse
from services import club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


INTEGRATION_NOT_FOUND = "Integration not found"


def _get_club_or_403(club_id: int, db_user: UserResponse) -> ClubResponse:
    """Fetch a club by ID (404 if missing) and verify the user is its owner or an admin (403 if not)."""
    return get_authorized_resource(
        lambda: club_service.get_club(club_id),
        CLUB_NOT_FOUND,
        db_user,
    )


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
