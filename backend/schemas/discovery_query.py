import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from core.constants import MAX_SCHOOL_LENGTH
from core.controlbox import controlbox

DiscoverySurface = Literal["events", "clubs", "positions"]


class DiscoveryQueryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    school: str = Field(min_length=1, max_length=MAX_SCHOOL_LENGTH)
    surface: DiscoverySurface
    search_query: str = Field(max_length=controlbox.discovery_queries.maximum_search_length)
    page_url: HttpUrl = Field(max_length=controlbox.discovery_queries.maximum_page_url_length)
    filters: dict[str, Any]

    @field_validator("filters")
    @classmethod
    def validate_filters_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > controlbox.discovery_queries.maximum_filters_bytes:
            raise ValueError("Query filters exceed the maximum size")
        return value


class DiscoveryQueryResponse(BaseModel):
    id: UUID
    school: str
    surface: DiscoverySurface
    search_query: str
    page_url: str
    filters: dict[str, Any]
    created_at: datetime
