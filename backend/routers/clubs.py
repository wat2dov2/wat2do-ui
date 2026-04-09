from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_current_user, require_owner_or_admin
from core.constants import (
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
)
from schemas.club import (
    ClubCreate,
    ClubUpdate,
    ClubResponse,
    DiscordIntegrationOptionsResponse,
    DiscordIntegrationUpdate,
    DiscordIntegrationResponse,
    ClubIntegrationUpdate,
    ClubIntegrationResponse,
    IntegrationPlatform,
)
from core.errors import CLUB_NOT_FOUND
from services import club_service

router = APIRouter(prefix="/clubs", tags=["clubs"])


def _get_club_or_403(club_id: int, auth_user: dict) -> ClubResponse:
    """Fetch a club by ID (404 if missing) and verify the user is its owner or an admin (403 if not)."""
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    require_owner_or_admin(auth_user, club.created_by)
    return club


@router.get("/", response_model=list[ClubResponse])
def list_clubs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    club_type: str | None = Query(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
):
    return club_service.list_clubs(skip=skip, limit=limit, club_type=club_type, search=search)


@router.get("/mine", response_model=list[ClubResponse])
def list_my_clubs(auth_user: dict = Depends(get_current_user)):
    """Return clubs owned by the authenticated user."""
    return club_service.list_clubs_by_owner(auth_user["id"])


@router.get(
    "/integrations/discord/options",
    response_model=DiscordIntegrationOptionsResponse,
)
def get_discord_options(_=Depends(get_current_user)):
    return club_service.get_discord_options()


@router.get(
    "/integrations/{platform}/options",
)
def get_platform_options(
    platform: IntegrationPlatform,
    _=Depends(get_current_user),
):
    return club_service.get_integration_options(platform)


@router.get("/{club_id}", response_model=ClubResponse)
def get_club(club_id: int):
    club = club_service.get_club(club_id)
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return club


@router.get(
    "/{club_id}/integrations/discord",
    response_model=DiscordIntegrationResponse,
)
def get_discord_integration(
    club_id: int,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.get_discord_integration(club_id)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.put(
    "/{club_id}/integrations/discord",
    response_model=DiscordIntegrationResponse,
)
def upsert_discord_integration(
    club_id: int,
    data: DiscordIntegrationUpdate,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.upsert_discord_integration(
        club_id=club_id,
        server_id=data.server_id,
        server_name=data.server_name,
        channel_id=data.channel_id,
        channel_name=data.channel_name,
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.delete(
    "/{club_id}/integrations/discord",
    response_model=DiscordIntegrationResponse,
)
def disconnect_discord_integration(
    club_id: int,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.disconnect_discord_integration(club_id)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.get(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def get_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.get_platform_integration(club_id, platform)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.put(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def upsert_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    data: ClubIntegrationUpdate,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.upsert_platform_integration(
        club_id=club_id,
        platform=platform,
        name=data.name,
        metadata=data.metadata,
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.delete(
    "/{club_id}/integrations/{platform}",
    response_model=ClubIntegrationResponse,
)
def disconnect_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    integration = club_service.disconnect_platform_integration(club_id, platform)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CLUB_NOT_FOUND)
    return integration


@router.post("/", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
def create_club(
    data: ClubCreate,
    auth_user: dict = Depends(get_current_user),
):
    return club_service.create_club(data, created_by=auth_user["id"])


@router.patch("/{club_id}", response_model=ClubResponse)
def update_club(
    club_id: int,
    data: ClubUpdate,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    updated = club_service.update_club(club_id, data)
    return updated


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_club(
    club_id: int,
    auth_user: dict = Depends(get_current_user),
):
    _get_club_or_403(club_id, auth_user)
    club_service.delete_club(club_id)
