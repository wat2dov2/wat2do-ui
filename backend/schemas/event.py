from datetime import datetime

from pydantic import BaseModel, field_validator

from constants import EVENT_CATEGORIES


def _validate_category(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    v = v.strip()
    if v not in EVENT_CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(EVENT_CATEGORIES)}")
    return v


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    location: str
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
    organization: str
    ig_handle: str | None = None
    discord_handle: str | None = None
    x_handle: str | None = None
    tiktok_handle: str | None = None
    fb_handle: str | None = None
    other_handle: str | None = None
    display_handle: str | None = None

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


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
    food: list[str] | None = None
    registration: bool | None = None
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


class LatestEventResponse(BaseModel):
    """Minimal payload for 'latest added event' (e.g. for 'X added 22 minutes ago')."""

    title: str
    added_at: datetime


class EventResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    location: str
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

    model_config = {"from_attributes": True}
