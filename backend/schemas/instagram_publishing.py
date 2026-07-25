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
    event_id: int
    position: int
    # The slide's live event, hydrated like any other card payload. Nothing
    # about it is stored on the batch: the events table is the source of truth
    # for everything a slide shows.
    event: EventSummaryResponse
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
