from datetime import datetime

from pydantic import BaseModel, field_validator


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

    model_config = {"from_attributes": True}
