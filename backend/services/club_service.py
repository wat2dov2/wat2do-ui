"""Clubs via Supabase. Sync."""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

from postgrest.exceptions import APIError

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.sanitize import sanitize_postgrest_value
from core.tables import CLUB_INTEGRATIONS, CLUBS
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubResponse,
    ClubUpdate,
    IntegrationPlatform,
)


def _normalize_club_name(name: str | None) -> str:
    return " ".join((name or "").casefold().split())


def list_clubs_by_owner(owner_id: str) -> list[ClubResponse]:
    """Return all clubs created by the given Supabase auth user id."""
    r = get_sb().table(CLUBS).select("*").eq("created_by", owner_id).execute()
    return [ClubResponse.model_validate(c) for c in (r.data or [])]


def user_owns_club_named(owner_id: str, club_name: str | None) -> bool:
    """Return whether a user owns the club attached to an event organization.

    Kept for promotion compatibility while callers migrate toward ``club_id``.
    """
    normalized = _normalize_club_name(club_name)
    if not normalized:
        return False
    return any(
        _normalize_club_name(club.club_name) == normalized for club in list_clubs_by_owner(owner_id)
    )


def resolve_event_club_for_owner(
    owner_id: str,
    *,
    club_id: int | None = None,
    organization: str | None = None,
) -> ClubResponse | None:
    """Resolve the verified club a non-admin user is creating an event for.

    ``club_id`` is the canonical ownership link. ``organization`` remains a
    compatibility fallback for older frontend payloads and multi-club owners.
    If a user owns exactly one club, that club wins so the backend, not a form
    text field, owns the published organization name.
    """
    owned_clubs = list_clubs_by_owner(owner_id)
    if not owned_clubs:
        return None

    if club_id is not None:
        return next((club for club in owned_clubs if club.id == club_id), None)

    if len(owned_clubs) == 1:
        return owned_clubs[0]

    normalized = _normalize_club_name(organization)
    if not normalized:
        return None
    return next(
        (club for club in owned_clubs if _normalize_club_name(club.club_name) == normalized),
        None,
    )


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
    school: str | None = None,
) -> list[ClubResponse]:
    q = get_sb().table(CLUBS).select("*")
    if club_type:
        q = q.eq("club_type", club_type)
    if school:
        q = q.eq("school", school)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            # Sanitize strips PostgREST control chars (commas, dots, parens,
            # quotes) then we double-quote so the value is a safe literal.
            quoted = f'"%{term}%"'
            q = q.or_(f"club_name.ilike.{quoted}")
    q = q.order("club_name").range(skip, skip + limit - 1)
    try:
        r = q.execute()
        clubs = [ClubResponse.model_validate(c) for c in (r.data or [])]
    except APIError as e:
        if e.code == "42703" and school:
            log.warning(
                "Database column 'school' does not exist in 'clubs' table. "
                "Filtering clubs in python fallback. Please run migrations."
            )
            # Re-run query without school filter
            q = get_sb().table(CLUBS).select("*")
            if club_type:
                q = q.eq("club_type", club_type)
            if search:
                term = sanitize_postgrest_value(search)
                if term:
                    quoted = f'"%{term}%"'
                    q = q.or_(f"club_name.ilike.{quoted}")
            q = q.order("club_name").range(skip, skip + limit - 1)
            r = q.execute()

            raw_clubs = [ClubResponse.model_validate(c) for c in (r.data or [])]
            default_school = "University of Waterloo"
            clubs = [c for c in raw_clubs if (c.school or default_school) == school]
        else:
            raise
    return clubs


def create_club(data: ClubCreate, *, created_by: str) -> ClubResponse:
    payload = data.model_dump(exclude={"owner_user_id"})
    payload["created_by"] = created_by
    try:
        r = get_sb().table(CLUBS).insert(payload).execute()
    except APIError as e:
        if e.code == "42703" and "school" in payload:
            log.warning(
                "Database column 'school' does not exist in 'clubs' table. "
                "Retrying club creation without school column."
            )
            del payload["school"]
            r = get_sb().table(CLUBS).insert(payload).execute()
        else:
            raise
    return ClubResponse.model_validate(r.data[0])


def update_club(club_id: int, data: ClubUpdate) -> ClubResponse | None:
    existing = get_club(club_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    try:
        r = get_sb().table(CLUBS).update(payload).eq("id", club_id).execute()
    except APIError as e:
        if e.code == "42703" and "school" in payload:
            log.warning(
                "Database column 'school' does not exist in 'clubs' table. "
                "Retrying club update without school column."
            )
            del payload["school"]
            if not payload:
                return existing
            r = get_sb().table(CLUBS).update(payload).eq("id", club_id).execute()
        else:
            raise
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
