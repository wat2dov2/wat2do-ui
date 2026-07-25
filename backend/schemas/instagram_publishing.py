from datetime import date, datetime
from typing import Any, Literal
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


class InstagramPublishItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    batch_id: UUID
    account_key: str
    event_id: int
    position: int | None
    included: bool
    event_snapshot: dict[str, Any]
    visual_score: float
    excitement_score: float
    audience_score: float
    timing_score: float
    overall_score: float
    ai_reason: str
    cover_candidate: bool
    asset_url: str
    meta_container_id: str | None = None
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
    cover_image_url: str | None = None
    ai_model: str | None = None
    version: int
    error_message: str | None = None
    meta_cover_container_id: str | None = None
    meta_carousel_container_id: str | None = None
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
    # carousel - including ones an admin added by hand - so the batch reconciles
    # its slides against this list instead of the generator's original items.
    event_ids: list[int] = Field(min_length=1, max_length=9)


class InstagramPublishBatchPublish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
