import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from core.constants import EVENT_CATEGORIES
from schemas.club import ClubCohostResponse, ClubTypeValue
from schemas.event_date import OccurrenceResponse, OccurrenceSummaryResponse

_log = logging.getLogger(__name__)

_CANONICAL_SET = frozenset(EVENT_CATEGORIES)


def normalize_category(raw: str) -> str | None:
    """Check if a raw category string belongs to the canonical categories.

    Returns the canonical category string, or ``None`` if it is unrecognized.
    """
    raw = raw.strip()
    if raw in _CANONICAL_SET:
        return raw
    _log.warning("Unrecognized category %r, dropping it", raw)
    return None


# One source for these descriptions: the API schema, the event extractor and the
# Rust ingestion agent's prompt all read them from this file.
EVENT_DISCOVERY = json.loads(
    Path(__file__).with_name("event_discovery_fields.json").read_text(encoding="utf-8")
)
_DISCOVERY_FIELDS: dict[str, str] = EVENT_DISCOVERY["fields"]


class EventDiscoveryFields(BaseModel):
    """Independent discovery facts; null means the source has not established the fact."""

    competition: bool | None = Field(
        default=None,
        strict=True,
        description=_DISCOVERY_FIELDS["competition"],
    )
    employers_on_campus: bool | None = Field(
        default=None,
        strict=True,
        description=_DISCOVERY_FIELDS["employers_on_campus"],
    )
    sports_game: bool | None = Field(
        default=None,
        strict=True,
        description=_DISCOVERY_FIELDS["sports_game"],
    )
    campus_season_ids: list[str] | None = Field(
        default=None,
        description=_DISCOVERY_FIELDS["campus_season_ids"],
    )

    @field_validator("campus_season_ids")
    @classmethod
    def _unique_campus_seasons(cls, value: list[str] | None) -> list[str] | None:
        return sorted(set(value)) if value is not None else None


# A map pin's [longitude, latitude], as map libraries take it.
MapCoordinates = tuple[
    Annotated[float, Field(ge=-180, le=180)], Annotated[float, Field(ge=-90, le=90)]
]


class EventSummaryResponse(EventDiscoveryFields):
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
    public GET /events/ and would otherwise leak the creator's user ID
    to anonymous callers.
    """

    id: int
    club_id: int | None = None
    title: str
    description: str | None = None
    location: str | None = None
    map_location: str | None = None
    # Stored when the map location is found, so the map needs no lookup of its own.
    map_coordinates: MapCoordinates | None = None
    occurrences: list[OccurrenceSummaryResponse] = Field(default_factory=list)
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    source_video_url: str | None = None
    title_font: str | None = Field(
        default=None,
        description="The web font closest to the lettering of the title on the event's poster",
    )
    source_url: str | None = None
    category: str | None = None
    club: str | None = None
    club_logo_url: str | None = None
    cohosts: list[ClubCohostResponse] = Field(default_factory=list)
    featured: bool = Field(default=False, description="Published to Instagram")
    is_directory_event: bool = False
    club_type: ClubTypeValue | None = None
    club_page: str | None = None
    club_ig: str | None = None
    club_discord: str | None = None
    ig_handle: str | None = None
    school: str | None = None
    cancelled: bool = False
    added_at: datetime
    # Set when a later source post changes this listing, null until one does. Drives
    # the "Updated" card badge, as ``added_at`` drives "New".
    last_source_changed_at: datetime | None = None

    model_config = {"from_attributes": True}


class EventResponse(EventDiscoveryFields):
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
    map_location: str | None = None
    # Stored when the map location is found, so the map needs no lookup of its own.
    map_coordinates: MapCoordinates | None = None
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)
    price: float | None = None
    food: list[str] | None = None
    registration: bool = False
    source_image_url: str | None = None
    source_video_url: str | None = None
    title_font: str | None = Field(
        default=None,
        description="The web font closest to the lettering of the title on the event's poster",
    )
    club_logo_url: str | None = None
    cohosts: list[ClubCohostResponse] = Field(default_factory=list)
    featured: bool = Field(default=False, description="Published to Instagram")
    is_directory_event: bool = False
    club_type: ClubTypeValue | None = None
    school: str | None = None
    source_url: str | None = None
    category: str | None = None
    club: str | None = None
    ig_handle: str | None = None
    cancelled: bool = False
    added_at: datetime
    last_source_changed_at: datetime | None = None
    created_by: str | None = None

    model_config = {"from_attributes": True}
