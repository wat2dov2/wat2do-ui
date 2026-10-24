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
    INSTAGRAM_MUSIC_ADDED,
    INSTAGRAM_MUSIC_FAILED,
    INSTAGRAM_MUSIC_PENDING,
)
from core.controlbox import controlbox
from schemas.event import EventSummaryResponse

InstagramPublishBatchKind = Literal["events", "employers_on_campus"]

InstagramPublishBatchStatus = Literal[
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
]


InstagramMusicStatus = Literal[
    INSTAGRAM_MUSIC_PENDING,
    INSTAGRAM_MUSIC_ADDED,
    INSTAGRAM_MUSIC_FAILED,
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
    instagram_user_id: str | None = None
    batch_kind: InstagramPublishBatchKind = "events"
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
    permalink: str | None = None
    # Set once the carousel publishes; the Mac's emulator then adds a song.
    music_status: InstagramMusicStatus | None = None
    music_track: str | None = None
    music_error: str | None = None
    published_cover_url: str | None = None
    published_outro_url: str | None = None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None


class InstagramPublishBatchSummaryResponse(InstagramPublishBatchBaseResponse):
    item_count: int = 0
    eligible_count: int = 0


class InstagramPublishBatchResponse(InstagramPublishBatchBaseResponse):
    # Unique events from the school's configured lookback ending at window_end,
    # plus every event currently selected for the carousel.
    sticker_selections: dict[str, list[str]] = Field(default_factory=dict)
    new_event_count: int = 0
    # The rest of that lookback's upcoming events, hydrated like a slide's
    # event, which the carousel's last slide lists. Never stored on the batch.
    other_events: list[EventSummaryResponse] = Field(default_factory=list)
    items: list[InstagramPublishItemResponse]


class InstagramPublishBatchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
    caption_intro: str = Field(default="", max_length=2200)
    cover_body: str = Field(
        default="", max_length=controlbox.instagram_publishing.cover_body_character_limit
    )
    # Carousel order, by event. The editor owns which events are on the
    # carousel - including ones an admin added by hand - so the batch stores
    # exactly this list.
    event_ids: list[int] = Field(min_length=1)


class InstagramPublishBatchPublish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)


class InstagramSongCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Typed loosely, the way an admin would say it: "the weeknd after hours".
    query: str = Field(min_length=1, max_length=200, pattern=r"\S")
    # Asian and K-pop songs play only on campuses with large Asian student communities.
    asian_campuses_only: bool = False


class InstagramSongResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    query: str
    asian_campuses_only: bool
    created_at: datetime
