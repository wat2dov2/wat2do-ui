from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.constants.validation import MAX_URL_LENGTH
from schemas.organization import OrganizationTypeValue

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


class PositionResponse(BaseModel):
    id: int
    organization_id: int
    title: str = Field(max_length=MAX_POSITION_TITLE_LENGTH)
    description: str = Field(max_length=MAX_POSITION_DESCRIPTION_LENGTH)
    position_type: PositionType
    requirements: list[PositionRequirement] = Field(
        default_factory=list,
        max_length=MAX_POSITION_REQUIREMENT_COUNT,
    )
    commitment: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    compensation: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    location: str | None = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    contact_email: str | None = Field(default=None, max_length=320)
    deadline_date: date | None = None
    deadline_at: datetime | None = None
    source_url: str = Field(max_length=MAX_URL_LENGTH)
    source_image_url: str | None = Field(default=None, max_length=MAX_URL_LENGTH)
    ingestion_source: Literal["manual", "instagram_scraper", "seed"]
    is_active: bool
    added_at: datetime
    updated_at: datetime
    organization_name: str
    organization_logo_url: str | None = None
    organization_type: OrganizationTypeValue | None = None
    organization_page: str | None = None
    organization_ig: str | None = None
    organization_discord: str | None = None
    school: str

    model_config = {"from_attributes": True}
