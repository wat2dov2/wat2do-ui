import logging
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
)

from core.constants import (
    CLUB_CATEGORIES,
    CLUB_TYPE_INDEPENDENT,
    MAX_CLUB_CATEGORY_COUNT,
    MAX_CLUB_CATEGORY_LENGTH,
    MAX_CLUB_NAME_LENGTH,
    MAX_CLUB_TYPE_LENGTH,
    MAX_SCHOOL_LENGTH,
    MAX_URL_LENGTH,
)

# ---------------------------------------------------------------------------
# Safe-URL validator - mirrors schemas.qr_code._is_safe_url so club fields
# that accept user-supplied URLs (club_page, logo_url) reject dangerous
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

_CANONICAL_ORG_CATEGORIES = frozenset(CLUB_CATEGORIES)

CategoryStr = Annotated[str, Field(min_length=1, max_length=MAX_CLUB_CATEGORY_LENGTH)]


def normalize_club_type(value: object) -> object:
    """Normalize club-type input before validating its signature slug."""
    return value.strip().lower() if isinstance(value, str) else value


ClubTypeValue = Annotated[
    str,
    BeforeValidator(normalize_club_type),
    StringConstraints(
        min_length=1,
        max_length=MAX_CLUB_TYPE_LENGTH,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]

# Review state for a club. Only approved clubs are listed
# publicly and may publish events.
CLUB_STATUS_PENDING = "pending"
CLUB_STATUS_APPROVED = "approved"
CLUB_STATUS_REJECTED = "rejected"
ClubStatus = Literal["pending", "approved", "rejected"]


def normalize_club_category(raw: str) -> str | None:
    """Return the canonical club category, or None if unrecognized."""
    raw = raw.strip()
    if raw in _CANONICAL_ORG_CATEGORIES:
        return raw
    if raw:
        _log.warning("Unrecognized club category %r, dropping it", raw)
    return None


def _validate_club_categories(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    normalized: list[str] = []
    for item in v:
        category = normalize_club_category(item)
        if category is None:
            raise ValueError(f"categories must be from: {', '.join(CLUB_CATEGORIES)}")
        if category not in normalized:
            normalized.append(category)
    return normalized


class ClubCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submitted_by_email: EmailStr
    club_name: str = Field(..., min_length=1, max_length=MAX_CLUB_NAME_LENGTH)
    categories: list[CategoryStr] | None = Field(default=None, max_length=MAX_CLUB_CATEGORY_COUNT)
    club_page: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ig: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    discord: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    club_type: ClubTypeValue = CLUB_TYPE_INDEPENDENT
    logo_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    school: str = Field(default="uwaterloo", min_length=1, max_length=MAX_SCHOOL_LENGTH)

    @field_validator("club_name", "school")
    @classmethod
    def _strip_non_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("value cannot be blank")
        return v

    @field_validator("club_page", "logo_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_http_url(v)

    @field_validator("categories")
    @classmethod
    def _categories(cls, v: list[str] | None) -> list[str] | None:
        return _validate_club_categories(v)


class ClubUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    club_name: str | None = Field(default=None, max_length=MAX_CLUB_NAME_LENGTH)
    categories: list[CategoryStr] | None = Field(default=None, max_length=MAX_CLUB_CATEGORY_COUNT)
    club_page: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ig: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    discord: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    club_type: ClubTypeValue | None = None
    logo_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_SCHOOL_LENGTH)

    @field_validator("club_name", "school")
    @classmethod
    def _not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("value cannot be blank on update")
        return v

    @field_validator("club_page", "logo_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_http_url(v)

    @field_validator("categories")
    @classmethod
    def _categories(cls, v: list[str] | None) -> list[str] | None:
        return _validate_club_categories(v)


class ClubResponse(BaseModel):
    id: int
    school_id: int | None = Field(default=None, exclude=True)
    club_name: str
    status: ClubStatus = CLUB_STATUS_APPROVED
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: ClubTypeValue = CLUB_TYPE_INDEPENDENT
    logo_url: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    school: str | None = None
    owner_email: str | None = None
    event_count: int = 0
    position_count: int = 0

    model_config = {"from_attributes": True}


class ClubSubmissionResponse(ClubResponse):
    submitted_by_email: str | None = None


class ClubMemberResponse(BaseModel):
    user_id: UUID
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class ClubMemberAdd(BaseModel):
    email: str


class ClubCohostResponse(BaseModel):
    """An additional existing club sharing an event or position."""

    id: int
    club_name: str
    logo_url: str | None = None
    club_type: ClubTypeValue | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
