"""Clubs via Supabase. Sync."""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

from core.database import get_sb
from schemas.club import (
    ClubCreate,
    ClubUpdate,
    ClubResponse,
    ClubIntegrationResponse,
    DiscordIntegrationResponse,
    IntegrationPlatform,
)


SUPPORTED_INTEGRATIONS: tuple[IntegrationPlatform, ...] = (
    "whatsapp",
    "discord",
    "instagram",
    "slack",
    "telegram",
    "linkedin",
    "facebook",
)


def get_club(club_id: int) -> ClubResponse | None:
    r = get_sb().table("clubs").select("*").eq("id", club_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return ClubResponse.model_validate(r.data[0])


def list_clubs(
    skip: int = 0,
    limit: int = 100,
    club_type: str | None = None,
    search: str | None = None,
) -> list[ClubResponse]:
    q = get_sb().table("clubs").select("*")
    if club_type:
        q = q.eq("club_type", club_type)
    if search:
        q = q.ilike("club_name", f"%{search}%")
    q = q.order("club_name").range(skip, skip + limit - 1)
    r = q.execute()
    return [ClubResponse.model_validate(c) for c in (r.data or [])]


def create_club(data: ClubCreate, *, created_by: str) -> ClubResponse:
    payload = data.model_dump()
    payload["created_by"] = created_by
    r = get_sb().table("clubs").insert(payload).execute()
    return ClubResponse.model_validate(r.data[0])


def update_club(club_id: int, data: ClubUpdate) -> ClubResponse | None:
    if get_club(club_id) is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    r = get_sb().table("clubs").update(payload).eq("id", club_id).execute()
    return ClubResponse.model_validate(r.data[0]) if r.data else None


def delete_club(club_id: int) -> bool:
    r = get_sb().table("clubs").delete().eq("id", club_id).execute()
    return bool(r.data)


def get_integration_options(platform: IntegrationPlatform) -> dict:
    if platform == "discord":
        return {
            "oauth_url": "https://discord.com/oauth2/authorize?client_id=wat2do-placeholder&scope=bot%20applications.commands&permissions=274877975552",
            "servers": [
                {
                    "id": "1",
                    "name": "UW Tech Club",
                    "channels": [
                        {"id": "101", "name": "#events"},
                        {"id": "102", "name": "#announcements"},
                        {"id": "103", "name": "#general"},
                    ],
                },
                {
                    "id": "2",
                    "name": "CS Student Association",
                    "channels": [
                        {"id": "201", "name": "#events"},
                        {"id": "202", "name": "#news"},
                    ],
                },
                {
                    "id": "3",
                    "name": "Engineering Society",
                    "channels": [
                        {"id": "301", "name": "#upcoming-events"},
                        {"id": "302", "name": "#socials"},
                    ],
                },
            ],
        }
    if platform == "slack":
        return {
            "oauth_url": "https://slack.com/oauth/v2/authorize?client_id=wat2do-placeholder&scope=channels:read,chat:write",
            "servers": [
                {
                    "id": "1",
                    "name": "UW Tech Club Workspace",
                    "channels": [
                        {"id": "101", "name": "#events"},
                        {"id": "102", "name": "#announcements"},
                        {"id": "103", "name": "#general"},
                    ],
                },
                {
                    "id": "2",
                    "name": "CS Students",
                    "channels": [
                        {"id": "201", "name": "#club-events"},
                        {"id": "202", "name": "#news"},
                    ],
                },
                {
                    "id": "3",
                    "name": "Engineering Hub",
                    "channels": [
                        {"id": "301", "name": "#upcoming"},
                        {"id": "302", "name": "#socials"},
                    ],
                },
            ],
        }
    if platform == "telegram":
        return {
            "oauth_url": None,
            "servers": [
                {"id": "1", "name": "UW Tech Club", "channels": []},
                {"id": "2", "name": "CS Events", "channels": []},
                {"id": "3", "name": "Engineering Society", "channels": []},
            ],
        }
    if platform == "linkedin":
        return {
            "oauth_url": "https://www.linkedin.com/oauth/v2/authorization?client_id=wat2do-placeholder&response_type=code",
            "servers": [
                {"id": "1", "name": "UW Tech Club", "channels": []},
                {"id": "2", "name": "CS Student Association", "channels": []},
                {"id": "3", "name": "Engineering Society", "channels": []},
            ],
        }
    if platform == "facebook":
        return {
            "oauth_url": "https://www.facebook.com/v20.0/dialog/oauth?client_id=wat2do-placeholder",
            "servers": [
                {"id": "page:1", "name": "UW Tech Club", "channels": []},
                {"id": "page:2", "name": "CS Student Association", "channels": []},
                {"id": "page:3", "name": "Engineering Society", "channels": []},
                {"id": "group:1", "name": "UW Tech Club Members", "channels": []},
                {"id": "group:2", "name": "CS Events & Announcements", "channels": []},
                {"id": "group:3", "name": "Engineering Student Hub", "channels": []},
            ],
        }
    return {"oauth_url": None, "servers": []}


def get_discord_options() -> dict:
    return get_integration_options("discord")


def _row_to_integration_response(row: dict) -> ClubIntegrationResponse:
    """Map a club_integrations DB row to the API response schema.

    Reconstructs a metadata dict using the original key names each
    platform expects.  Slack sends workspace_id/workspace_name which
    are stored in the server_id/server_name columns, so we emit
    the workspace_* aliases for Slack.
    """
    platform = row["platform"]
    metadata: dict[str, str] = {}

    # Server/workspace — Slack uses workspace_id/workspace_name aliases.
    if row.get("server_id"):
        if platform == "slack":
            metadata["workspace_id"] = row["server_id"]
        else:
            metadata["server_id"] = row["server_id"]
    if row.get("server_name"):
        if platform == "slack":
            metadata["workspace_name"] = row["server_name"]
        else:
            metadata["server_name"] = row["server_name"]
    if row.get("channel_id"):
        metadata["channel_id"] = row["channel_id"]
    if row.get("channel_name"):
        metadata["channel_name"] = row["channel_name"]
    if row.get("handle"):
        metadata["handle"] = row["handle"]
    if row.get("group_id"):
        metadata["group_id"] = row["group_id"]
    if row.get("group_name"):
        metadata["group_name"] = row["group_name"]
    if row.get("page_id"):
        metadata["page_id"] = row["page_id"]
    if row.get("page_name"):
        metadata["page_name"] = row["page_name"]
    if row.get("connection_type"):
        metadata["connection_type"] = row["connection_type"]
    # Merge anything from the extra JSONB column.
    extra = row.get("extra") or {}
    if isinstance(extra, dict):
        for k, v in extra.items():
            if isinstance(v, str):
                metadata[k] = v

    return ClubIntegrationResponse(
        club_id=row["club_id"],
        platform=platform,
        connected=bool(row.get("connected", False)),
        name=row.get("name"),
        last_sync=str(row["last_sync"]) if row.get("last_sync") else None,
        metadata=metadata,
    )


def _empty_integration_response(club_id: int, platform: IntegrationPlatform) -> ClubIntegrationResponse:
    """Return a disconnected placeholder for a platform with no DB row."""
    return ClubIntegrationResponse(
        club_id=club_id,
        platform=platform,
        connected=False,
        name=None,
        last_sync=None,
        metadata={},
    )


def _metadata_to_columns(platform: IntegrationPlatform, metadata: dict[str, str] | None) -> dict:
    """Extract well-known metadata keys into typed column values.

    Slack sends workspace_id/workspace_name which map to the same
    server_id/server_name columns used by Discord.
    """
    m = metadata or {}
    return {
        "server_id": m.get("server_id") or m.get("workspace_id"),
        "server_name": m.get("server_name") or m.get("workspace_name"),
        "channel_id": m.get("channel_id"),
        "channel_name": m.get("channel_name"),
        "handle": m.get("handle"),
        "group_id": m.get("group_id"),
        "group_name": m.get("group_name"),
        "page_id": m.get("page_id"),
        "page_name": m.get("page_name"),
        "connection_type": m.get("connection_type"),
    }


def get_platform_integration(club_id: int, platform: IntegrationPlatform) -> ClubIntegrationResponse | None:
    club = get_club(club_id)
    if club is None:
        return None
    r = (
        get_sb()
        .table("club_integrations")
        .select("*")
        .eq("club_id", club_id)
        .eq("platform", platform)
        .execute()
    )
    if r.data and len(r.data) > 0:
        return _row_to_integration_response(r.data[0])
    return _empty_integration_response(club_id, platform)


def upsert_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    name: str | None = None,
    metadata: dict[str, str] | None = None,
) -> ClubIntegrationResponse | None:
    club = get_club(club_id)
    if club is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    columns = _metadata_to_columns(platform, metadata)
    payload = {
        "club_id": club_id,
        "platform": platform,
        "connected": True,
        "name": name,
        "last_sync": now,
        "updated_at": now,
        **columns,
    }
    r = (
        get_sb()
        .table("club_integrations")
        .upsert(payload, on_conflict="club_id,platform")
        .execute()
    )
    if not r.data:
        log.warning("Failed to upsert integration for club_id=%s platform=%s", club_id, platform)
        return None
    return _row_to_integration_response(r.data[0])


def disconnect_platform_integration(club_id: int, platform: IntegrationPlatform) -> ClubIntegrationResponse | None:
    club = get_club(club_id)
    if club is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    # Check if row exists; if not, just return empty.
    r = (
        get_sb()
        .table("club_integrations")
        .select("id")
        .eq("club_id", club_id)
        .eq("platform", platform)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return _empty_integration_response(club_id, platform)
    # Set connected=false and clear data columns.
    update_payload = {
        "connected": False,
        "name": None,
        "last_sync": None,
        "server_id": None,
        "server_name": None,
        "channel_id": None,
        "channel_name": None,
        "handle": None,
        "group_id": None,
        "group_name": None,
        "page_id": None,
        "page_name": None,
        "connection_type": None,
        "extra": {},
        "updated_at": now,
    }
    r = (
        get_sb()
        .table("club_integrations")
        .update(update_payload)
        .eq("club_id", club_id)
        .eq("platform", platform)
        .execute()
    )
    if not r.data:
        log.warning("Failed to disconnect integration for club_id=%s platform=%s", club_id, platform)
        return None
    return _row_to_integration_response(r.data[0])


def get_discord_integration(club_id: int) -> DiscordIntegrationResponse | None:
    integration = get_platform_integration(club_id, "discord")
    if integration is None:
        return None
    metadata = integration.metadata or {}
    return DiscordIntegrationResponse(
        club_id=club_id,
        connected=integration.connected,
        name=integration.name,
        server_id=metadata.get("server_id"),
        server_name=metadata.get("server_name"),
        channel_id=metadata.get("channel_id"),
        channel_name=metadata.get("channel_name"),
        last_sync=integration.last_sync,
    )


def upsert_discord_integration(
    club_id: int,
    server_id: str,
    server_name: str,
    channel_id: str,
    channel_name: str,
) -> DiscordIntegrationResponse | None:
    integration = upsert_platform_integration(
        club_id=club_id,
        platform="discord",
        name=f"{server_name} - {channel_name}",
        metadata={
            "server_id": server_id,
            "server_name": server_name,
            "channel_id": channel_id,
            "channel_name": channel_name,
        },
    )
    if integration is None:
        return None
    return get_discord_integration(club_id)


def disconnect_discord_integration(club_id: int) -> DiscordIntegrationResponse | None:
    integration = disconnect_platform_integration(club_id, "discord")
    if integration is None:
        return None
    return get_discord_integration(club_id)
