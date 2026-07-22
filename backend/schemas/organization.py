import logging
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.constants import (
    MAX_INTEGRATION_METADATA_KEY_LENGTH,
    MAX_INTEGRATION_METADATA_KEYS,
    MAX_INTEGRATION_METADATA_VALUE_LENGTH,
    MAX_INTEGRATION_NAME_LENGTH,
    MAX_ORGANIZATION_CATEGORY_COUNT,
    MAX_ORGANIZATION_CATEGORY_LENGTH,
    MAX_ORGANIZATION_NAME_LENGTH,
    MAX_SCHOOL_LENGTH,
    MAX_URL_LENGTH,
    ORGANIZATION_CATEGORIES,
)

# ---------------------------------------------------------------------------
# Safe-URL validator - mirrors schemas.qr_code._is_safe_url so organization fields
# that accept user-supplied URLs (organization_page, logo_url) reject dangerous
# schemes (javascript:, data:, file:) before they reach storage or FE.
# ---------------------------------------------------------------------------
_SAFE_URL_PROTOCOLS = {"http", "https"}


def _is_safe_http_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in _SAFE_URL_PROTOCOLS and bool(parsed.netloc)
    except Exception:
        return False


def _validate_http_url(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not _is_safe_http_url(v):
        raise ValueError("URL must use http or https scheme")
    return v


from typing import Annotated

_log = logging.getLogger(__name__)

_CANONICAL_ORG_CATEGORIES = frozenset(ORGANIZATION_CATEGORIES)

CategoryStr = Annotated[str, Field(min_length=1, max_length=MAX_ORGANIZATION_CATEGORY_LENGTH)]


def normalize_organization_category(raw: str) -> str | None:
    """Return the canonical organization category, or None if unrecognized."""
    raw = raw.strip()
    if raw in _CANONICAL_ORG_CATEGORIES:
        return raw
    if raw:
        _log.warning("Unrecognized organization category %r, dropping it", raw)
    return None


def _validate_organization_categories(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    normalized: list[str] = []
    for item in v:
        category = normalize_organization_category(item)
        if category is None:
            raise ValueError(f"categories must be from: {', '.join(ORGANIZATION_CATEGORIES)}")
        if category not in normalized:
            normalized.append(category)
    return normalized


class OrganizationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_name: str = Field(..., min_length=1, max_length=MAX_ORGANIZATION_NAME_LENGTH)
    categories: list[CategoryStr] | None = Field(
        default=None, max_length=MAX_ORGANIZATION_CATEGORY_COUNT
    )
    organization_page: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ig: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    discord: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    association_affiliated: bool = False
    logo_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    school: str = Field(default="uwaterloo", min_length=1, max_length=MAX_SCHOOL_LENGTH)

    @field_validator("organization_name", "school")
    @classmethod
    def _strip_non_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("value cannot be blank")
        return v

    @field_validator("organization_page", "logo_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_http_url(v)

    @field_validator("categories")
    @classmethod
    def _categories(cls, v: list[str] | None) -> list[str] | None:
        return _validate_organization_categories(v)


class OrganizationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_name: str | None = Field(default=None, max_length=MAX_ORGANIZATION_NAME_LENGTH)
    categories: list[CategoryStr] | None = Field(
        default=None, max_length=MAX_ORGANIZATION_CATEGORY_COUNT
    )
    organization_page: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ig: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    discord: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    association_affiliated: bool | None = None
    logo_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)

    @field_validator("organization_name", "school")
    @classmethod
    def _not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("value cannot be blank on update")
        return v

    @field_validator("organization_page", "logo_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_http_url(v)

    @field_validator("categories")
    @classmethod
    def _categories(cls, v: list[str] | None) -> list[str] | None:
        return _validate_organization_categories(v)


class OrganizationEventStats(BaseModel):
    """Aggregated event activity for organization list cards."""

    event_count: int = 0
    latest_event_title: str | None = None
    latest_event_added_at: datetime | None = None


class OrganizationResponse(BaseModel):
    id: int
    organization_name: str
    categories: list[str] | None = None
    organization_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    association_affiliated: bool = False
    logo_url: str | None = None
    created_by: str | None = None
    school: str | None = None
    owner_email: str | None = None
    event_count: int = 0
    latest_event_title: str | None = None
    latest_event_added_at: datetime | None = None

    model_config = {"from_attributes": True}


class DiscordChannelOption(BaseModel):
    id: str
    name: str


class DiscordServerOption(BaseModel):
    id: str
    name: str
    channels: list[DiscordChannelOption]


class DiscordIntegrationOptionsResponse(BaseModel):
    oauth_url: str
    servers: list[DiscordServerOption]


class PlatformIntegrationOptionsResponse(BaseModel):
    """Generic options for any integration platform.

    The Discord-specific response above keeps the tightest types for the
    ``/integrations/discord/options`` endpoint; this looser model lets
    the ``/integrations/{platform}/options`` endpoint lock its OpenAPI
    contract without over-constraining platforms whose OAuth URLs are
    still placeholders.
    """

    oauth_url: str | None = None
    servers: list[DiscordServerOption] = []


IntegrationPlatform = Literal[
    "whatsapp",
    "discord",
    "instagram",
    "slack",
    "telegram",
    "linkedin",
    "facebook",
]


class OrganizationIntegrationUpdate(BaseModel):
    """Update request for a organization's integration configuration.

    The ``metadata`` dict is now bounded on three axes:
    - max key count (``MAX_INTEGRATION_METADATA_KEYS``)
    - max per-key length (``MAX_INTEGRATION_METADATA_KEY_LENGTH``)
    - max per-value length (``MAX_INTEGRATION_METADATA_VALUE_LENGTH``)

    Unknown envelope fields are rejected via ``extra="forbid"`` so future
    refactors that accidentally echo request data back to the DB do not
    introduce a mass-assignment surface.
    """

    model_config = ConfigDict(extra="forbid")

    connected: bool = True
    name: str | None = Field(default=None, max_length=MAX_INTEGRATION_NAME_LENGTH)
    metadata: dict[str, str] | None = None

    @model_validator(mode="after")
    def _metadata_bounds(self):
        m = self.metadata
        if m is None:
            return self
        if len(m) > MAX_INTEGRATION_METADATA_KEYS:
            raise ValueError(f"metadata exceeds maximum of {MAX_INTEGRATION_METADATA_KEYS} keys")
        for k, v in m.items():
            if len(k) > MAX_INTEGRATION_METADATA_KEY_LENGTH:
                raise ValueError(
                    f"metadata key length exceeds {MAX_INTEGRATION_METADATA_KEY_LENGTH}"
                )
            if not isinstance(v, str) or len(v) > MAX_INTEGRATION_METADATA_VALUE_LENGTH:
                raise ValueError(
                    f"metadata value length exceeds {MAX_INTEGRATION_METADATA_VALUE_LENGTH}"
                )
        return self


class OrganizationIntegrationResponse(BaseModel):
    organization_id: int
    platform: IntegrationPlatform
    connected: bool
    name: str | None = None
    last_sync: datetime | None = None
    metadata: dict[str, str] | None = None


class OrganizationMemberResponse(BaseModel):
    user_id: UUID
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class OrganizationMemberAdd(BaseModel):
    email: str
