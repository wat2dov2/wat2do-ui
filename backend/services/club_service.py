"""Clubs via Supabase. Sync."""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

from uuid import UUID

from postgrest.exceptions import APIError

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.sanitize import sanitize_postgrest_value
from core.tables import CLUB_INTEGRATIONS, CLUB_INVITATIONS, CLUB_MEMBERS, CLUBS
from schemas.club import (
    ClubCreate,
    ClubIntegrationResponse,
    ClubMemberResponse,
    ClubResponse,
    ClubUpdate,
    IntegrationPlatform,
)


def _normalize_club_name(name: str | None) -> str:
    return " ".join((name or "").casefold().split())


def _fetch_owner_email(user_id: str | None) -> str | None:
    if not user_id:
        return None
    try:
        user_row = get_sb().table("users").select("email").eq("id", user_id).execute()
        if user_row.data and isinstance(user_row.data, list) and len(user_row.data) > 0:
            first_row = user_row.data[0]
            if isinstance(first_row, dict):
                email = first_row.get("email")
                if isinstance(email, str):
                    return email
    except Exception as e:
        log.warning("Failed to fetch owner email for %s: %s", user_id, e)
    return None


def list_clubs_by_owner(owner_id: str) -> list[ClubResponse]:
    """Return all clubs where the user is a member/manager."""
    clubs_dict = {}

    # Query via club_members junction table
    try:
        r_members = (
            get_sb().table(CLUB_MEMBERS).select("clubs(*)").eq("user_id", owner_id).execute()
        )
        for row in r_members.data or []:
            if row.get("clubs"):
                club_data = row["clubs"]
                email = _fetch_owner_email(club_data.get("created_by"))
                club = ClubResponse.model_validate({**club_data, "owner_email": email})
                clubs_dict[club.id] = club
    except Exception as e:
        log.warning("Failed to query club_members for owner_id %s: %s", owner_id, e)

    return list(clubs_dict.values())


def is_club_member(club_id: int, user_id: str) -> bool:
    """Return whether a user is a member of the club."""
    try:
        r = (
            get_sb()
            .table(CLUB_MEMBERS)
            .select("id")
            .eq("club_id", club_id)
            .eq("user_id", user_id)
            .execute()
        )
        if r.data:
            return True
    except Exception as e:
        log.warning("Failed to query club_members in is_club_member: %s", e)

    return False


def list_club_members(club_id: int) -> list[ClubMemberResponse]:
    """Return all members/managers of the club."""
    r = get_sb().table(CLUB_MEMBERS).select("joined_at, users(*)").eq("club_id", club_id).execute()
    members = []
    club = get_club(club_id)
    if not club:
        return []

    for row in r.data or []:
        u_data = row.get("users")
        if not u_data:
            continue
        u_id = u_data["id"]

        members.append(
            ClubMemberResponse(
                user_id=UUID(u_id),
                email=u_data["email"],
                full_name=u_data.get("full_name"),
                avatar_url=u_data.get("avatar_url"),
                role="Member",
                joined_at=datetime.fromisoformat(row["joined_at"]),
            )
        )

    return members


def add_club_member(club_id: int, user_id: UUID) -> ClubMemberResponse:
    """Add a user as a member of the club."""
    from services import user_service

    user = user_service.get_user(user_id)
    if not user:
        raise NotFoundError("User not found")

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "club_id": club_id,
        "user_id": str(user_id),
        "joined_at": now,
    }

    try:
        r = get_sb().table(CLUB_MEMBERS).insert(payload).execute()
    except APIError as e:
        if e.code == "23505":
            raise ConflictError("User is already a member of this club")
        raise

    if not r.data:
        raise APIError("Failed to add club member")

    inserted = r.data[0]
    return ClubMemberResponse(
        user_id=user_id,
        email=user.email,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        role="Member",
        joined_at=datetime.fromisoformat(inserted["joined_at"]),
    )


def remove_club_member(club_id: int, user_id: UUID) -> bool:
    """Remove a user from the club's members."""
    r = (
        get_sb()
        .table(CLUB_MEMBERS)
        .delete()
        .eq("club_id", club_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(r.data)


def get_club(club_id: int) -> ClubResponse | None:
    r = get_sb().table(CLUBS).select("*").eq("id", club_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    email = _fetch_owner_email(r.data[0].get("created_by"))
    return ClubResponse.model_validate({**r.data[0], "owner_email": email})


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
    r = q.execute()
    items = []
    for row in (r.data or []):
        email = _fetch_owner_email(row.get("created_by"))
        items.append(ClubResponse.model_validate({**row, "owner_email": email}))
    return items


def create_club(data: ClubCreate, *, created_by: str) -> ClubResponse:
    payload = data.model_dump(exclude={"owner_user_id"})
    payload["created_by"] = created_by
    r = get_sb().table(CLUBS).insert(payload).execute()
    email = _fetch_owner_email(created_by)
    club = ClubResponse.model_validate({**r.data[0], "owner_email": email})
    # Auto-add the creator/owner as a member
    try:
        add_club_member(club.id, UUID(created_by))
    except Exception as e:
        log.warning("Failed to auto-add creator %s to club members: %s", created_by, e)
    return club


def update_club(club_id: int, data: ClubUpdate) -> ClubResponse | None:
    existing = get_club(club_id)
    if existing is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return existing
    r = get_sb().table(CLUBS).update(payload).eq("id", club_id).execute()
    if r.data:
        email = _fetch_owner_email(r.data[0].get("created_by"))
        return ClubResponse.model_validate({**r.data[0], "owner_email": email})
    return None


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


# --- Club Invitations Service Methods ---


def create_invitation(club_id: int, email: str, invited_by: UUID) -> dict:
    """Create or renew an invitation for an email to join a club, and send the email."""
    # 1. Verify club exists
    club = get_club(club_id)
    if not club:
        raise NotFoundError("Club not found")

    from services import user_service

    inviter = user_service.get_user(invited_by)
    if not inviter:
        raise NotFoundError("Inviting user not found")

    # 2. Restrict emails to match the inviter's school domain (except for admins)
    if inviter.role != "admin":
        from core.allowed_emails import get_school_for_email

        invited_school = get_school_for_email(email)
        if (
            not invited_school
            or not inviter.school
            or invited_school.lower() != inviter.school.lower()
        ):
            raise ValidationError(
                f"You can only invite emails matching your school domain ({inviter.school or 'Unknown'})."
            )

    # 3. Check if already a member
    existing_user = user_service.get_user_by_email(email)
    if existing_user and is_club_member(club_id, str(existing_user.id)):
        raise ConflictError("User is already a member of this club")

    # 3. Generate token & expiry (7 days)
    import uuid
    from datetime import timedelta

    token = uuid.uuid4()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=7)

    payload = {
        "club_id": club_id,
        "email": email.strip().lower(),
        "token": str(token),
        "invited_by": str(invited_by),
        "status": "pending",
        "expires_at": expires_at.isoformat(),
        "created_at": now.isoformat(),
    }

    try:
        # Upsert: if an invite for (club_id, email) already exists, overwrite it.
        r = get_sb().table(CLUB_INVITATIONS).upsert(payload, on_conflict="club_id,email").execute()
        if not r.data:
            raise APIError("Failed to create invitation")
        invitation = r.data[0]
    except Exception as e:
        log.error("Failed to create/upsert invitation: %s", e)
        raise

    # 4. Dispatch the invitation email
    try:
        from core.config import settings
        from services.email_service import EmailMessage, email_service

        invite_url = f"{settings.frontend_url}/invite/{token}"
        subject = f"Invitation to manage {club.club_name} on Wat2Do"
        body_html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #3b82f6;">You're Invited!</h2>
          <p>You have been invited to join the management team of <strong>{club.club_name}</strong> on Wat2Do.</p>
          <p>Click the button below to accept the invitation and get access to the club panel:</p>
          <div style="margin: 30px 0;">
            <a href="{invite_url}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Accept Invitation</a>
          </div>
          <p style="font-size: 12px; color: #64748b;">This invitation link will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
        </div>
        """
        body_text = f"You have been invited to join the management team of {club.club_name} on Wat2Do. Click the link to accept: {invite_url}"
        msg = EmailMessage(to=email, subject=subject, body_html=body_html, body_text=body_text)
        email_service.send(msg)
    except Exception as e:
        log.warning("Failed to send invitation email: %s", e)

    return invitation


def list_invitations(club_id: int) -> list[dict]:
    """List all pending, non-expired invitations for a club."""
    now = datetime.now(timezone.utc).isoformat()
    r = (
        get_sb()
        .table(CLUB_INVITATIONS)
        .select("*")
        .eq("club_id", club_id)
        .eq("status", "pending")
        .gt("expires_at", now)
        .execute()
    )
    return r.data or []


def revoke_invitation(club_id: int, invitation_id: str) -> bool:
    """Revoke (delete) a pending invitation."""
    r = (
        get_sb()
        .table(CLUB_INVITATIONS)
        .delete()
        .eq("club_id", club_id)
        .eq("id", invitation_id)
        .execute()
    )
    return bool(r.data)


def get_invitation_by_token(token: str) -> dict:
    """Retrieve public invitation details by token. Raises NotFoundError if invalid/expired."""
    now = datetime.now(timezone.utc).isoformat()
    r = (
        get_sb()
        .table(CLUB_INVITATIONS)
        .select("*, clubs(club_name)")
        .eq("token", token)
        .eq("status", "pending")
        .gt("expires_at", now)
        .execute()
    )
    if not r.data:
        raise NotFoundError("Invitation not found or has expired")

    inv = r.data[0]
    club_name = inv.get("clubs", {}).get("club_name", "Unknown Club")
    return {
        "club_name": club_name,
        "email": inv["email"],
        "expires_at": inv["expires_at"],
    }


def accept_invitation(token: str, user_id: UUID) -> bool:
    """Accept an invitation by token and add the user to the club."""
    now = datetime.now(timezone.utc).isoformat()

    # 1. Fetch and validate invitation
    r = (
        get_sb()
        .table(CLUB_INVITATIONS)
        .select("*")
        .eq("token", token)
        .eq("status", "pending")
        .gt("expires_at", now)
        .execute()
    )
    if not r.data:
        raise NotFoundError("Invitation not found or has expired")

    inv = r.data[0]
    club_id = inv["club_id"]

    # 2. Add user to club members
    try:
        add_club_member(club_id, user_id)
    except ConflictError:
        pass

    # 3. Mark invitation as accepted
    get_sb().table(CLUB_INVITATIONS).update({"status": "accepted"}).eq("id", inv["id"]).execute()
    return True


# --- Club Claims & Join Requests Service Methods ---

def create_claim(club_id: int, user_id: UUID, role: str, proof_url: str | None) -> dict:
    club = get_club(club_id)
    if not club:
        raise NotFoundError("Club not found")
    if club.created_by is not None:
        raise ConflictError("Club is already claimed")

    payload = {
        "club_id": club_id,
        "user_id": str(user_id),
        "executive_role": role,
        "proof_url": proof_url,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = get_sb().table("club_claims").insert(payload).execute()
    if not r.data:
        raise APIError("Failed to submit claim")
    return r.data[0]


def list_pending_claims() -> list[dict]:
    r = get_sb().table("club_claims").select("*, clubs(*), users(*)").eq("status", "pending").execute()
    return r.data or []


def update_claim(claim_id: UUID, status: str, rejection_reason: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    r = get_sb().table("club_claims").update({
        "status": status,
        "rejection_reason": rejection_reason,
        "updated_at": now
    }).eq("id", str(claim_id)).execute()

    if not r.data:
        raise NotFoundError("Claim not found")

    claim = r.data[0]
    if status == "approved":
        # Set club creator (internal users.id UUID)
        get_sb().table("clubs").update({"created_by": claim["user_id"]}).eq("id", claim["club_id"]).execute()
        # Add to club members
        try:
            add_club_member(claim["club_id"], UUID(claim["user_id"]))
        except ConflictError:
            pass

    return claim


def create_join_request(club_id: int, user_id: UUID, pitch: str) -> dict:
    club = get_club(club_id)
    if not club:
        raise NotFoundError("Club not found")
    if is_club_member(club_id, str(user_id)):
        raise ConflictError("You are already a member of this club")

    payload = {
        "club_id": club_id,
        "user_id": str(user_id),
        "pitch": pitch,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = get_sb().table("club_join_requests").insert(payload).execute()
    if not r.data:
        raise APIError("Failed to submit join request")
    return r.data[0]


def list_join_requests(club_id: int) -> list[dict]:
    r = get_sb().table("club_join_requests").select("*, users(*)").eq("club_id", club_id).eq("status", "pending").execute()
    return r.data or []


def update_join_request(request_id: UUID, status: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    r = get_sb().table("club_join_requests").update({
        "status": status,
        "updated_at": now
    }).eq("id", str(request_id)).execute()

    if not r.data:
        raise NotFoundError("Join request not found")

    req = r.data[0]
    if status == "approved":
        try:
            add_club_member(req["club_id"], UUID(req["user_id"]))
        except ConflictError:
            pass

    return req

