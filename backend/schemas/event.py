from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from constants import EVENT_CATEGORIES
from core.constants import (
    MAX_EVENT_CATEGORY_LENGTH,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_ORGANIZATION_LENGTH,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
    MAX_URL_LENGTH,
)

# Reusable constrained-string type for individual food tags.
FoodStr = Annotated[str, Field(min_length=1, max_length=MAX_EVENT_FOOD_ITEM_LENGTH)]


def _validate_category(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    v = v.strip()
    if v not in EVENT_CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(EVENT_CATEGORIES)}")
    return v


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=MAX_EVENT_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_EVENT_DESCRIPTION_LENGTH)
    location: str = Field(..., min_length=1, max_length=MAX_EVENT_LOCATION_LENGTH)
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
    food: list[FoodStr] | None = Field(default=None, max_length=MAX_EVENT_FOOD_COUNT)
    registration: bool = False
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    club_type: str | None = Field(default=None, max_length=MAX_EVENT_CLUB_TYPE_LENGTH)
    school: str | None = Field(default=None, max_length=MAX_EVENT_SCHOOL_LENGTH)
    source_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    category: str | None = Field(default=None, max_length=MAX_EVENT_CATEGORY_LENGTH)
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


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=MAX_EVENT_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_EVENT_DESCRIPTION_LENGTH)
    location: str | None = Field(default=None, max_length=MAX_EVENT_LOCATION_LENGTH)
    dtstart_utc: datetime | None = None
    dtend_utc: datetime | None = None
    price: float | None = None
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


class LatestEventResponse(BaseModel):
    """Minimal payload for 'latest added event' (e.g. for 'X added 22 minutes ago')."""

    title: str
    added_at: datetime


class EventTimeMeta(BaseModel):
    """Minimal event metadata for time-decay calculations."""
    id: int
    dtstart_utc: str | None = None
    added_at: str | None = None


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
