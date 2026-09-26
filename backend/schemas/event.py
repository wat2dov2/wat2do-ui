import logging
from datetime import datetime
from typing import Annotated
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import (
    EVENT_CATEGORIES,
    MAX_EVENT_CATEGORY_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_PRICE,
    MAX_EVENT_TITLE_LENGTH,
    MAX_URL_LENGTH,
)
from core.pagination import LatestAddedItem, PaginatedResponse
from schemas.club import ClubTypeValue
from schemas.event_date import (
    OccurrenceCreate,
    OccurrenceResponse,
    OccurrenceSummaryResponse,
    OccurrenceUpdate,
)

_log = logging.getLogger(__name__)

_CANONICAL_SET = frozenset(EVENT_CATEGORIES)


# Reusable constrained-string type for individual food tags.
FoodStr = Annotated[str, Field(min_length=1, max_length=MAX_EVENT_FOOD_ITEM_LENGTH)]

# Allowed URL schemes for event-owned links (source_url, source_image_url).
# Rejects javascript:, data:, file:, ftp: - all historical XSS / SSRF vectors.
_SAFE_URL_PROTOCOLS = {"http", "https"}


def _is_safe_http_url(url: str) -> bool:
    """Return True for well-formed http(s) URLs only."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in _SAFE_URL_PROTOCOLS and bool(parsed.netloc)
    except Exception:
        return False


def _validate_optional_http_url(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not _is_safe_http_url(v):
        raise ValueError("URL must use http or https scheme")
    return v


def _validate_optional_handle(v: str | None) -> str | None:
    """Accept either a plain handle/string or an http(s) URL; reject other schemes.

    Social handles in the wild are a mix of @user forms and full profile URLs.
    We reject any value that *looks* like a URL (contains a scheme colon) but
    uses a scheme other than http/https - that catches ``javascript:`` /
    ``data:`` / ``file:`` without being pedantic about @-handles.
    """
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    # Heuristic: if the value contains "://" it is being sent as a URL.
    if "://" in v:
        if not _is_safe_http_url(v):
            raise ValueError("handle URL must use http or https scheme")
    return v


def normalize_category(raw: str) -> str | None:
    """Check if a raw category string belongs to the canonical categories.

    Returns the canonical category string, or ``None`` if it is unrecognized.
    """
    raw = raw.strip()
    if raw in _CANONICAL_SET:
        return raw
    _log.warning("Unrecognized category %r, dropping it", raw)
    return None


def _validate_category(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    normalized = normalize_category(v)
    if normalized is None:
        raise ValueError(f"category must be one of: {', '.join(EVENT_CATEGORIES)}")
    return normalized


# Bounded, finite, non-negative price field.  Mirrors the ge/le/allow_inf_nan
# guard applied to the max_price query param so create/update & list paths
# all agree on what a valid price looks like.
PriceField = Annotated[float, Field(ge=0, le=MAX_EVENT_PRICE, allow_inf_nan=False)]


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=MAX_EVENT_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_EVENT_DESCRIPTION_LENGTH)
    location: str = Field(..., min_length=1, max_length=MAX_EVENT_LOCATION_LENGTH)
    # Occurrences live in the event_dates table - one row per occurrence,
    # one events row per logical event. Per-occurrence dtstart/dtend
    # validation lives on OccurrenceCreate; the only constraint here is
    # that an event has at least one occurrence.
    occurrences: list[OccurrenceCreate] = Field(..., min_length=1)
    price: PriceField | None = None
    food: list[FoodStr] | None = Field(default=None, max_length=MAX_EVENT_FOOD_COUNT)
    registration: bool = False
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    source_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    category: str | None = Field(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH)
    # The owning club is the single source of truth for the event's display
    # name, type, and school; the server derives those fields from club_id
    # (see event_service._resolve_club_fields), so they are not accepted here.
    club_id: int = Field(..., ge=1)
    ig_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    cancelled: bool = False

    @field_validator("category")
    @classmethod
    def _category_allowed(cls, v: str | None) -> str | None:
        return _validate_category(v)

    @field_validator("source_image_url", "source_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_optional_http_url(v)

    @field_validator(
        "ig_handle",
    )
    @classmethod
    def _safe_handle(cls, v: str | None) -> str | None:
        return _validate_optional_handle(v)


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_EVENT_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_EVENT_DESCRIPTION_LENGTH)
    location: str | None = Field(default=None, max_length=MAX_EVENT_LOCATION_LENGTH)
    # ``None`` (the default) leaves occurrences unchanged. An empty list
    # is rejected - every event must have at least one occurrence - so
    # callers wanting to clear dates must instead delete the event.
    occurrences: list[OccurrenceUpdate] | None = Field(default=None, min_length=1)
    price: PriceField | None = None
    food: list[FoodStr] | None = Field(default=None, max_length=MAX_EVENT_FOOD_COUNT)
    registration: bool | None = None
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    source_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    category: str | None = Field(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH)
    # Reassigning the club re-derives club/school server-side.
    club_id: int | None = Field(default=None, ge=1)
    ig_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    cancelled: bool | None = None

    @field_validator("category")
    @classmethod
    def _category_allowed(cls, v: str | None) -> str | None:
        return _validate_category(v)

    @field_validator("source_image_url", "source_url")
    @classmethod
    def _safe_url(cls, v: str | None) -> str | None:
        return _validate_optional_http_url(v)

    @field_validator(
        "ig_handle",
    )
    @classmethod
    def _safe_handle(cls, v: str | None) -> str | None:
        return _validate_optional_handle(v)


class EventTimeMeta(BaseModel):
    """Minimal event metadata for time-decay calculations.

    Decay keys off ``added_at`` (catalog age), not ``dtstart_utc`` -
    see the rationale in recommender/popularity.py. The field
    used to be on this model when ``events`` carried dtstart_utc as a
    column; occurrence dates now live in event_dates.
    """

    id: int
    added_at: str | None = None


class EventSummaryResponse(BaseModel):
    """Payload for list/card views.

    Description is included because the feed search matches event copy as well
    as titles, hosts, locations, and food.

    The owning club's display/link/social fields (``club_logo_url``,
    ``club_type``, ``club_page``, ``club_ig``,
    ``club_discord``) are
    embedded read-time from the ``clubs`` row via the
    ``events.club_id`` FK so the event card can render without a second
    fetch.

    ``created_by`` is intentionally omitted - this response is returned on
    public GET /events/ and would otherwise leak the creator's Supabase
    auth UID to anonymous callers.
    """

    id: int
    title: str
    description: str | None = None
    location: str | None = None
    occurrences: list[OccurrenceSummaryResponse] = Field(default_factory=list)
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    source_url: str | None = None
    category: str | None = None
    club: str | None = None
    club_logo_url: str | None = None
    club_type: ClubTypeValue | None = None
    club_page: str | None = None
    club_ig: str | None = None
    club_discord: str | None = None
    ig_handle: str | None = None
    school: str | None = None
    cancelled: bool = False
    added_at: datetime

    model_config = {"from_attributes": True}


class EventFeedResponse(PaginatedResponse[EventSummaryResponse]):
    """Public school feed response with catalog-freshness metadata."""

    latest_added_event: LatestAddedItem | None = Field(
        default=None, description="School freshness metadata on the first page only."
    )


class EventStatsResponse(BaseModel):
    """Volatile public card stats loaded separately from the cached event feed."""

    click_count: int = 0
    going_count: int = 0


class EventResponse(BaseModel):
    """Full event payload returned from GET /events/{id} and used internally
    for ownership checks.

    ``created_by`` is retained here because the field is load-bearing for
    the authorization layer (``get_authorized_resource`` reads it); the
    public list endpoint hides it via ``EventSummaryResponse`` which
    omits the field entirely.

    ``occurrences`` is the canonical date list.
    """

    id: int
    club_id: int | None = None
    title: str
    description: str | None = None
    location: str | None = None
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    club_logo_url: str | None = None
    club_type: ClubTypeValue | None = None
    school: str | None = None
    source_url: str | None = None
    category: str | None = None
    club: str | None = None
    ig_handle: str | None = None
    cancelled: bool = False
    added_at: datetime
    created_by: str | None = None

    model_config = {"from_attributes": True}


class EventPublicResponse(BaseModel):
    """Like EventResponse but without ``created_by``, so public detail
    views do not leak creator UUIDs to unauthenticated callers.
    """

    id: int
    club_id: int | None = None
    title: str
    description: str | None = None
    location: str | None = None
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    club_logo_url: str | None = None
    club_type: ClubTypeValue | None = None
    school: str | None = None
    source_url: str | None = None
    category: str | None = None
    club: str | None = None
    ig_handle: str | None = None
    cancelled: bool = False
    added_at: datetime

    model_config = {"from_attributes": True}
