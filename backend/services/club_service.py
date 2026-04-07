"""Clubs via Supabase. Sync."""

import json
import logging
from datetime import datetime

log = logging.getLogger(__name__)

from core.database import get_sb
from schemas.club import ClubCreate, ClubUpdate, ClubResponse, IntegrationPlatform


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


def _get_integration_blob(club: ClubResponse) -> dict[str, dict]:
    raw = club.discord
    if not raw:
        return {}
    if not isinstance(raw, str):
        return {}
    if not raw.strip().startswith("{"):
        # Legacy plain Discord link/handle.
        return {
            "discord": {
                "connected": True,
                "name": raw,
                "last_sync": None,
                "metadata": {},
            }
        }
    try:
        parsed = json.loads(raw)
    except Exception as e:
        log.warning("Failed to parse integrations JSON: %s", e)
        return {}
    if isinstance(parsed, dict) and "_integrations" in parsed:
        integrations = parsed.get("_integrations")
        return integrations if isinstance(integrations, dict) else {}
    # Legacy discord-only JSON payload.
    return {
        "discord": {
            "connected": bool(parsed.get("connected", True)),
            "name": parsed.get("name"),
            "last_sync": parsed.get("last_sync"),
            "metadata": {
                "server_id": parsed.get("server_id"),
                "server_name": parsed.get("server_name"),
                "channel_id": parsed.get("channel_id"),
                "channel_name": parsed.get("channel_name"),
            },
        }
    }


def _save_integration_blob(club_id: int, integrations: dict[str, dict]) -> bool:
    payload = {"_integrations": integrations}
    r = (
        get_sb()
        .table("clubs")
        .update({"discord": json.dumps(payload)})
        .eq("id", club_id)
        .execute()
    )
    return bool(r.data)


def get_platform_integration(club_id: int, platform: IntegrationPlatform) -> dict | None:
    club = get_club(club_id)
    if club is None:
        return None
    integrations = _get_integration_blob(club)
    data = integrations.get(platform) or {}
    return {
        "club_id": club_id,
        "platform": platform,
        "connected": bool(data.get("connected", False)),
        "name": data.get("name"),
        "last_sync": data.get("last_sync"),
        "metadata": data.get("metadata") or {},
    }


def upsert_platform_integration(
    club_id: int,
    platform: IntegrationPlatform,
    name: str | None = None,
    metadata: dict[str, str] | None = None,
) -> dict | None:
    club = get_club(club_id)
    if club is None:
        return None
    integrations = _get_integration_blob(club)
    integrations[platform] = {
        "connected": True,
        "name": name,
        "last_sync": datetime.utcnow().isoformat(),
        "metadata": metadata or {},
    }
    if not _save_integration_blob(club_id, integrations):
        return None
    return get_platform_integration(club_id, platform)


def disconnect_platform_integration(club_id: int, platform: IntegrationPlatform) -> dict | None:
    club = get_club(club_id)
    if club is None:
        return None
    integrations = _get_integration_blob(club)
    integrations[platform] = {
        "connected": False,
        "name": None,
        "last_sync": None,
        "metadata": {},
    }
    if not _save_integration_blob(club_id, integrations):
        return None
    return get_platform_integration(club_id, platform)


def get_discord_integration(club_id: int) -> dict | None:
    integration = get_platform_integration(club_id, "discord")
    if integration is None:
        return None
    metadata = integration.get("metadata") or {}
    return {
        "club_id": club_id,
        "connected": integration.get("connected", False),
        "name": integration.get("name"),
        "server_id": metadata.get("server_id"),
        "server_name": metadata.get("server_name"),
        "channel_id": metadata.get("channel_id"),
        "channel_name": metadata.get("channel_name"),
        "last_sync": integration.get("last_sync"),
    }


def upsert_discord_integration(
    club_id: int,
    server_id: str,
    server_name: str,
    channel_id: str,
    channel_name: str,
) -> dict | None:
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


def disconnect_discord_integration(club_id: int) -> dict | None:
    integration = disconnect_platform_integration(club_id, "discord")
    if integration is None:
        return None
    return get_discord_integration(club_id)
