"""Clubs via Supabase. Sync."""

import logging
from datetime import datetime, timezone
from typing import get_args

log = logging.getLogger(__name__)

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.sanitize import sanitize_postgrest_value
from core.tables import CLUB_INTEGRATIONS, CLUBS
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubResponse,
    ClubUpdate,
    DiscordIntegrationResponse,
    IntegrationPlatform,
)

SUPPORTED_INTEGRATIONS: tuple[IntegrationPlatform, ...] = get_args(IntegrationPlatform)


def list_clubs_by_owner(owner_id: str) -> list[ClubResponse]:
    """Return all clubs created by the given Supabase auth user id."""
    r = get_sb().table(CLUBS).select("*").eq("created_by", owner_id).execute()
    return [ClubResponse.model_validate(c) for c in (r.data or [])]


def get_club(club_id: int) -> ClubResponse | None:
    r = get_sb().table(CLUBS).select("*").eq("id", club_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return ClubResponse.model_validate(r.data[0])


def list_clubs(
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    club_type: str | None = None,
    search: str | None = None,
) -> list[ClubResponse]:
    q = get_sb().table(CLUBS).select("*")
    if club_type:
        q = q.eq("club_type", club_type)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            # Sanitize strips PostgREST control chars (commas, dots, parens,
            # quotes) then we double-quote so the value is a safe literal.
            quoted = f'"%{term}%"'
            q = q.or_(f"club_name.ilike.{quoted}")
    q = q.order("club_name").range(skip, skip + limit - 1)
    r = q.execute()
    return [ClubResponse.model_validate(c) for c in (r.data or [])]


def create_club(data: ClubCreate, *, created_by: str) -> ClubResponse:
    payload = data.model_dump()
    payload["created_by"] = created_by
    r = get_sb().table(CLUBS).insert(payload).execute()
    return ClubResponse.model_validate(r.data[0])


def update_club(club_id: int, data: ClubUpdate) -> ClubResponse | None:
    existing = get_club(club_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    r = get_sb().table(CLUBS).update(payload).eq("id", club_id).execute()
    return ClubResponse.model_validate(r.data[0]) if r.data else None


def delete_club(club_id: int) -> bool:
    r = get_sb().table(CLUBS).delete().eq("id", club_id).execute()
    return bool(r.data)


# ---------------------------------------------------------------------------
# Integration platform config — data-driven dispatch replaces if/elif chain.
# To add a new platform: add an entry here and to the IntegrationPlatform
# Literal in schemas/club.py.  No service code needs to change.
# ---------------------------------------------------------------------------
_PLACEHOLDER_SERVERS = [
    {"id": "1", "name": "UW Tech Club", "channels": []},
    {"id": "2", "name": "CS Student Association", "channels": []},
    {"id": "3", "name": "Engineering Society", "channels": []},
]

_PLATFORM_OPTIONS: dict[str, dict] = {
    "discord": {
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
    },
    "slack": {
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
    },
    "telegram": {
        "oauth_url": None,
        "servers": _PLACEHOLDER_SERVERS,
    },
    "linkedin": {
        "oauth_url": "https://www.linkedin.com/oauth/v2/authorization?client_id=wat2do-placeholder&response_type=code",
        "servers": _PLACEHOLDER_SERVERS,
    },
    "facebook": {
        "oauth_url": "https://www.facebook.com/v20.0/dialog/oauth?client_id=wat2do-placeholder",
        "servers": [
            {"id": "page:1", "name": "UW Tech Club", "channels": []},
            {"id": "page:2", "name": "CS Student Association", "channels": []},
            {"id": "page:3", "name": "Engineering Society", "channels": []},
            {"id": "group:1", "name": "UW Tech Club Members", "channels": []},
            {"id": "group:2", "name": "CS Events & Announcements", "channels": []},
            {"id": "group:3", "name": "Engineering Student Hub", "channels": []},
        ],
    },
    "whatsapp": {
        "oauth_url": None,
        "servers": _PLACEHOLDER_SERVERS,
    },
    "instagram": {
        "oauth_url": None,
        "servers": _PLACEHOLDER_SERVERS,
    },
}


def get_integration_options(platform: IntegrationPlatform) -> dict:
    return _PLATFORM_OPTIONS.get(platform, {"oauth_url": None, "servers": []})


def get_discord_options() -> dict:
    return get_integration_options("discord")


# ---------------------------------------------------------------------------
# Metadata column mapping — single source of truth for DB columns, platform
# aliases, and the bidirectional transformations between them.
# ---------------------------------------------------------------------------

# DB columns that store well-known metadata values.
_METADATA_COLUMNS = frozenset(
    {
        "server_id",
        "server_name",
        "channel_id",
        "channel_name",
        "handle",
        "group_id",
        "group_name",
        "page_id",
        "page_name",
        "connection_type",
    }
)

# Per-platform column-to-metadata-key aliases. When a platform stores a value
# in a generic column (e.g. server_id) but the API should emit a different key
# (e.g. workspace_id for Slack), the mapping is defined here.  Columns not
# listed fall through to their own name as the metadata key.
_PLATFORM_COLUMN_ALIASES: dict[str, dict[str, str]] = {
    "slack": {
        "server_id": "workspace_id",
        "server_name": "workspace_name",
    },
}

# Combined set of recognised metadata keys: DB columns plus all alias targets.
_KNOWN_METADATA_KEYS = _METADATA_COLUMNS | frozenset(
    alias for aliases in _PLATFORM_COLUMN_ALIASES.values() for alias in aliases.values()
)

# Per-platform map from metadata key -> typed-response field name.
# Used by platform-specific response builders (e.g. _integration_to_discord)
# to derive field values from the generic metadata dict, keeping the mapping
# in sync with _METADATA_COLUMNS and _PLATFORM_COLUMN_ALIASES automatically.
_PLATFORM_RESPONSE_FIELDS: dict[str, dict[str, str]] = {
    "discord": {
        "server_id": "server_id",
        "server_name": "server_name",
        "channel_id": "channel_id",
        "channel_name": "channel_name",
    },
}


def _columns_to_metadata(platform: str, row: dict) -> dict[str, str]:
    """Extract metadata dict from a DB row, applying platform aliases.

    This is the single place that knows how to read DB columns and produce
    an API-facing metadata dict (including extra JSONB fields).
    """
    aliases = _PLATFORM_COLUMN_ALIASES.get(platform, {})
    metadata: dict[str, str] = {}

    for col in _METADATA_COLUMNS:
        value = row.get(col)
        if value:
            key = aliases.get(col, col)
            metadata[key] = value

    # Merge anything from the extra JSONB column.
    extra = row.get("extra") or {}
    if isinstance(extra, dict):
        for k, v in extra.items():
            if isinstance(v, str):
                metadata[k] = v

    return metadata


def _metadata_to_columns(platform: IntegrationPlatform, metadata: dict[str, str] | None) -> dict:
    """Convert an API-facing metadata dict back into DB column values.

    Uses _PLATFORM_COLUMN_ALIASES to resolve alias keys (e.g. Slack's
    workspace_id -> server_id column).  Unrecognized keys are stored in
    the ``extra`` JSONB column.
    """
    m = metadata or {}
    aliases = _PLATFORM_COLUMN_ALIASES.get(platform, {})
    reverse_aliases: dict[str, str] = {v: k for k, v in aliases.items()}

    all_known = _KNOWN_METADATA_KEYS | set(reverse_aliases)
    extra = {k: v for k, v in m.items() if k not in all_known}

    columns: dict[str, str | dict | None] = {}
    for col in _METADATA_COLUMNS:
        alias = aliases.get(col)
        columns[col] = m.get(col) or (m.get(alias) if alias else None)
    columns["extra"] = extra
    return columns


def _row_to_integration_response(row: dict) -> ClubIntegrationResponse:
    """Map a club_integrations DB row to the API response schema."""
    platform = row["platform"]
    return ClubIntegrationResponse(
        club_id=row["club_id"],
        platform=platform,
        connected=bool(row.get("connected", False)),
        name=row.get("name"),
        last_sync=str(row["last_sync"]) if row.get("last_sync") else None,
        metadata=_columns_to_metadata(platform, row),
    )


def _empty_integration_response(
    club_id: int, platform: IntegrationPlatform
) -> ClubIntegrationResponse:
    """Return a disconnected placeholder for a platform with no DB row."""
    return ClubIntegrationResponse(
        club_id=club_id,
        platform=platform,
        connected=False,
        name=None,
        last_sync=None,
        metadata={},
    )


def get_platform_integration(
    club_id: int, platform: IntegrationPlatform
) -> ClubIntegrationResponse | None:
    club = get_club(club_id)
    if club is None:
        return None
    r = (
        get_sb()
        .table(CLUB_INTEGRATIONS)
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
    r = get_sb().table(CLUB_INTEGRATIONS).upsert(payload, on_conflict="club_id,platform").execute()
    if not r.data:
        log.warning("Failed to upsert integration for club_id=%s platform=%s", club_id, platform)
        return None
    return _row_to_integration_response(r.data[0])


def disconnect_platform_integration(
    club_id: int, platform: IntegrationPlatform
) -> ClubIntegrationResponse | None:
    club = get_club(club_id)
    if club is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    # Set connected=false and clear data columns.
    # If no row exists the UPDATE returns empty data — we return the empty
    # integration response in that case (no separate SELECT needed).
    # Null-payload is derived from _METADATA_COLUMNS so new fields are
    # automatically cleared on disconnect.
    update_payload: dict = {
        "connected": False,
        "name": None,
        "last_sync": None,
        "extra": {},
        "updated_at": now,
    }
    update_payload.update({col: None for col in _METADATA_COLUMNS})
    r = (
        get_sb()
        .table(CLUB_INTEGRATIONS)
        .update(update_payload)
        .eq("club_id", club_id)
        .eq("platform", platform)
        .execute()
    )
    if not r.data:
        return _empty_integration_response(club_id, platform)
    return _row_to_integration_response(r.data[0])


def _integration_to_discord(integration: ClubIntegrationResponse) -> DiscordIntegrationResponse:
    """Build a DiscordIntegrationResponse from a generic integration.

    Derives field values from _PLATFORM_RESPONSE_FIELDS["discord"] so that
    adding a new discord metadata field only requires a single dict entry
    (plus the schema field).
    """
    metadata = integration.metadata or {}
    field_map = _PLATFORM_RESPONSE_FIELDS.get("discord", {})
    mapped = {field: metadata.get(meta_key) for meta_key, field in field_map.items()}
    return DiscordIntegrationResponse(
        club_id=integration.club_id,
        connected=integration.connected,
        name=integration.name,
        last_sync=integration.last_sync,
        **mapped,
    )


def get_discord_integration(club_id: int) -> DiscordIntegrationResponse | None:
    integration = get_platform_integration(club_id, "discord")
    if integration is None:
        return None
    return _integration_to_discord(integration)


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
