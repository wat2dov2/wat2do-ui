from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from core.constants import (
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
)

InstagramPublishBatchStatus = Literal[
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
]


class InstagramCarouselEvent(BaseModel):
    """Live event data a slide reads, joined onto the carousel for display.

    Nothing here is stored on the batch: it is read from the events table every
    time the carousel is loaded or published, so an edited event changes its
    slide with no further bookkeeping.
    """

    model_config = ConfigDict(extra="ignore")

    id: int
    title: str | None = None
    category: str | None = None
    location: str | None = None
    organization: str | None = None
    ig_handle: str | None = None
    school: str | None = None
    source_image_url: str | None = None
    dtstart_utc: datetime | None = None
    """IANA zone resolved server-side; slides print local times."""
    tz: str | None = None
    price: float | None = None
    food: list[str] | None = None
    cancelled: bool | None = None


class InstagramPublishItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    batch_id: UUID
    account_key: str
    event_id: int
    position: int
    event: InstagramCarouselEvent
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class InstagramPublishBatchResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    account_key: str
    instagram_user_id: str
    school: str
    local_date: date
    window_start: datetime
    window_end: datetime
    status: InstagramPublishBatchStatus
    caption: str
    cover_body: str = ""
    ai_model: str | None = None
    version: int
    error_message: str | None = None
    meta_media_id: str | None = None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None
    items: list[InstagramPublishItemResponse]


class InstagramPublishBatchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
    caption: str = Field(min_length=1, max_length=2200)
    cover_body: str = Field(default="", max_length=280)
    # Carousel order, by event. The editor owns which events are on the
    # carousel - including ones an admin added by hand - so the batch stores
    # exactly this list.
    event_ids: list[int] = Field(min_length=1, max_length=9)


class InstagramPublishBatchPublish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
