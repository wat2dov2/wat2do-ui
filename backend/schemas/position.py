from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    field_validator,
    model_validator,
)

from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.constants.validation import MAX_URL_LENGTH
from core.pagination import LatestAddedItem, PaginatedResponse
from schemas.club import ClubTypeValue

PositionType = Literal[
    "executive",
    "committee",
    "volunteer",
    "staff",
    "internship",
    "general",
]

PositionRequirement = Annotated[
    str,
    Field(min_length=1, max_length=MAX_POSITION_REQUIREMENT_LENGTH),
]


class PositionFields(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_POSITION_TITLE_LENGTH)
    description: str = Field(min_length=1, max_length=MAX_POSITION_DESCRIPTION_LENGTH)
    position_type: PositionType
    requirements: list[PositionRequirement] = Field(
        default_factory=list,
        max_length=MAX_POSITION_REQUIREMENT_COUNT,
    )
    commitment: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    compensation: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    is_paid: bool | None = None
    location: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    contact_email: str | None = Field(default=None, max_length=320)
    deadline_date: date | None = None
    deadline_at: AwareDatetime | None = None


class PositionCreate(PositionFields):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    club_id: int = Field(ge=1)
    source_url: str = Field(min_length=1, max_length=MAX_URL_LENGTH)
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)

    @field_validator("source_url", "source_image_url")
    @classmethod
    def safe_url(cls, value: str | None) -> str | None:
        if value is not None:
            HttpUrl(value)
        return value

    @model_validator(mode="after")
    def valid_deadline(self):
        if self.deadline_at is not None and self.deadline_date is None:
            raise ValueError("deadline_at requires deadline_date")
        return self


class PositionResponse(PositionFields):
    id: int
    club_id: int
    source_url: str = Field(max_length=MAX_URL_LENGTH)
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ingestion_source: Literal["manual", "instagram_scraper", "seed"]
    is_active: bool
    added_at: datetime
    updated_at: datetime
    club_name: str
    club_logo_url: str | None = None
    club_type: ClubTypeValue | None = None
    club_page: str | None = None
    club_ig: str | None = None
    club_discord: str | None = None
    school: str

    model_config = {"from_attributes": True}


class PositionDirectoryResponse(PaginatedResponse[PositionResponse]):
    latest_added_position: LatestAddedItem | None = None
