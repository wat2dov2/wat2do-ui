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
from schemas.event import EventSummaryResponse

InstagramPublishBatchStatus = Literal[
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
]


class InstagramPublishItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    batch_id: UUID
    account_key: str
    event_id: int | None
    position: int
    # The slide's live event, hydrated like any other card payload. Nothing
    # about it is stored on the batch: the events table is the source of truth
    # for everything a slide shows.
    event: EventSummaryResponse | None
    # The PNG this slide published as, kept once the carousel is live so the
    # run keeps showing what Instagram got rather than re-rendering the event.
    published_asset_url: str | None = None
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class InstagramPublishBatchBaseResponse(BaseModel):
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
    caption_intro: str = ""
    cover_body: str = ""
    version: int
    error_message: str | None = None
    meta_media_id: str | None = None
    published_cover_url: str | None = None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None


class InstagramPublishBatchSummaryResponse(InstagramPublishBatchBaseResponse):
    item_count: int = 0
    eligible_count: int = 0


class InstagramPublishBatchResponse(InstagramPublishBatchBaseResponse):
    # Unique events from the school's configured lookback ending at window_end,
    # plus every event currently selected for the carousel.
    new_event_count: int = 0
    items: list[InstagramPublishItemResponse]


class InstagramPublishBatchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
    caption_intro: str = Field(default="", max_length=2200)
    cover_body: str = Field(default="", max_length=280)
    # Carousel order, by event. The editor owns which events are on the
    # carousel - including ones an admin added by hand - so the batch stores
    # exactly this list.
    event_ids: list[int] = Field(min_length=1)


class InstagramPublishBatchPublish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
