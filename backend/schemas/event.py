import logging
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import (
    CATEGORY_NORMALIZE_MAP,
    EVENT_CATEGORIES,
    EVENT_STATUS_ACTIVE,
    EVENT_STATUS_CANCELLED,
    MAX_EVENT_CATEGORY_LENGTH,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_ORGANIZATION_LENGTH,
    MAX_EVENT_PRICE,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
    MAX_URL_LENGTH,
)
from schemas.event_date import OccurrenceCreate, OccurrenceResponse

# events.status column — Literal-typed so the value renders as an enum
# in the OpenAPI schema and the generated TS types stay in sync.
EventStatus = Literal[EVENT_STATUS_ACTIVE, EVENT_STATUS_CANCELLED]

_log = logging.getLogger(__name__)

_CANONICAL_SET = frozenset(EVENT_CATEGORIES)


def _normalize_food(v: object) -> list[str] | None:
    """Accept both legacy string and list forms of the ``food`` field."""
    if v is None:
        return None
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return v
    return None


# Reusable constrained-string type for individual food tags.
FoodStr = Annotated[str, Field(min_length=1, max_length=MAX_EVENT_FOOD_ITEM_LENGTH)]

# Allowed URL schemes for event-owned links (source_url, source_image_url).
# Rejects javascript:, data:, file:, ftp: — all historical XSS / SSRF vectors.
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
    uses a scheme other than http/https — that catches ``javascript:`` /
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
    """Map a raw category string to the canonical value.

    Returns the canonical category string, or ``None`` if the value
    cannot be mapped (in which case it should be dropped).
    """
    raw = raw.strip()
    if raw in _CANONICAL_SET:
        return raw
    mapped = CATEGORY_NORMALIZE_MAP.get(raw)
    if mapped is not None:
        _log.warning("Legacy category %r normalized to %r", raw, mapped)
        return mapped
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
    # Occurrences live in the event_dates table — one row per occurrence,
    # one events row per logical event. Per-occurrence dtstart/dtend
    # validation lives on OccurrenceCreate; the only constraint here is
    # that an event has at least one occurrence (matches v1's required
    # EventDates).
    occurrences: list[OccurrenceCreate] = Field(..., min_length=1)
    price: PriceField | None = None
    food: list[FoodStr] | None = Field(default=None, max_length=MAX_EVENT_FOOD_COUNT)
    registration: bool = False
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    club_type: str | None = Field(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH)
    source_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    category: str | None = Field(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH)
    club_id: int | None = Field(default=None, ge=1)
    organization: str = Field(..., min_length=1, max_length=MAX_EVENT_ORGANIZATION_LENGTH)
    ig_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    discord_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    x_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    tiktok_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    fb_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    other_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    display_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)

    @field_validator("organization")
    @classmethod
    def _org_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("organization is required")
        return v

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
        "discord_handle",
        "x_handle",
        "tiktok_handle",
        "fb_handle",
        "other_handle",
        "display_handle",
    )
    @classmethod
    def _safe_handle(cls, v: str | None) -> str | None:
        return _validate_optional_handle(v)


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_EVENT_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_EVENT_DESCRIPTION_LENGTH)
    location: str | None = Field(default=None, max_length=MAX_EVENT_LOCATION_LENGTH)
    status: EventStatus | None = None
    # ``None`` (the default) leaves occurrences unchanged. An empty list
    # is rejected — every event must have at least one occurrence — so
    # callers wanting to clear dates must instead delete the event.
    occurrences: list[OccurrenceCreate] | None = Field(default=None, min_length=1)
    price: PriceField | None = None
    food: list[FoodStr] | None = Field(default=None, max_length=MAX_EVENT_FOOD_COUNT)
    registration: bool | None = None
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    club_type: str | None = Field(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH)
    source_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    category: str | None = Field(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH)
    organization: str | None = Field(default=None, max_length=MAX_EVENT_ORGANIZATION_LENGTH)
    ig_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    discord_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    x_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    tiktok_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    fb_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    other_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)
    display_handle: str | None = Field(default=None, max_length=MAX_EVENT_HANDLE_LENGTH)

    @field_validator("organization")
    @classmethod
    def _org_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("organization cannot be blank")
        return v

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
        "discord_handle",
        "x_handle",
        "tiktok_handle",
        "fb_handle",
        "other_handle",
        "display_handle",
    )
    @classmethod
    def _safe_handle(cls, v: str | None) -> str | None:
        return _validate_optional_handle(v)


class LatestEventResponse(BaseModel):
    """Minimal payload for 'latest added event' (e.g. for 'X added 22 minutes ago')."""

    title: str
    added_at: datetime


class EventTimeMeta(BaseModel):
    """Minimal event metadata for time-decay calculations.

    Decay keys off ``added_at`` (catalog age), not ``dtstart_utc`` —
    see the rationale in recommender/popularity.py. The field
    used to be on this model when ``events`` carried dtstart_utc as a
    column; after the v1-style EventDates port (migration
    20260428031741) we drop it from the model too.
    """

    id: int
    added_at: str | None = None


class EventSummaryResponse(BaseModel):
    """Lightweight payload for list/card views — omits large text fields
    (description, social handles) that are only needed in detail views.
    Keeps the payload ~60-70 % smaller than EventResponse for typical events.

    ``created_by`` is intentionally omitted — this response is returned on
    public GET /events/ and would otherwise leak the creator's Supabase
    auth UID to anonymous callers (see audit I10 / S16).
    """

    id: int
    title: str
    location: str
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    category: str | None = None
    organization: str | None = None
    display_handle: str | None = None
    school: str | None = None
    added_at: datetime
    status: EventStatus = EVENT_STATUS_ACTIVE

    model_config = {"from_attributes": True}

    @field_validator("food", mode="before")
    @classmethod
    def _food_str_to_list(cls, v: object) -> list[str] | None:
        return _normalize_food(v)


class EventResponse(BaseModel):
    """Full event payload returned from GET /events/{id} and used internally
    for ownership checks.

    ``created_by`` is retained here because the field is load-bearing for
    the authorization layer (``get_authorized_resource`` reads it); the
    public list endpoint hides it via ``EventSummaryResponse`` which
    omits the field entirely.

    ``occurrences`` is the canonical date list. ``dtstart_utc`` /
    ``dtend_utc`` are denormalized "primary date" convenience fields
    populated by the service layer (earliest future occurrence, or
    earliest occurrence if the event has only past dates). They are
    NOT columns on the events table — see migration
    20260428031741_add_event_dates_table.sql.
    """

    id: int
    club_id: int | None = None
    title: str
    description: str | None = None
    location: str
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    club_type: str | None = None
    school: str | None = None
    source_url: str | None = None
    category: str | None = None
    organization: str | None = None
    ig_handle: str | None = None
    discord_handle: str | None = None
    x_handle: str | None = None
    tiktok_handle: str | None = None
    fb_handle: str | None = None
    other_handle: str | None = None
    display_handle: str | None = None
    added_at: datetime
    created_by: str | None = None
    status: EventStatus = EVENT_STATUS_ACTIVE

    model_config = {"from_attributes": True}

    @field_validator("food", mode="before")
    @classmethod
    def _food_str_to_list(cls, v: object) -> list[str] | None:
        return _normalize_food(v)


class EventPublicResponse(BaseModel):
    """Public response for GET /events/{id} — identical to EventResponse
    but with ``created_by`` stripped to avoid leaking creator UUIDs to
    unauthenticated callers (see audit I10).
    """

    id: int
    title: str
    description: str | None = None
    location: str
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    club_type: str | None = None
    school: str | None = None
    source_url: str | None = None
    category: str | None = None
    organization: str | None = None
    ig_handle: str | None = None
    discord_handle: str | None = None
    x_handle: str | None = None
    tiktok_handle: str | None = None
    fb_handle: str | None = None
    other_handle: str | None = None
    display_handle: str | None = None
    added_at: datetime
    status: EventStatus = EVENT_STATUS_ACTIVE

    model_config = {"from_attributes": True}

    @field_validator("food", mode="before")
    @classmethod
    def _food_str_to_list(cls, v: object) -> list[str] | None:
        return _normalize_food(v)
