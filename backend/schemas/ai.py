from pydantic import BaseModel, Field

from schemas.position import PositionFields


class EventFormOccurrenceResponse(BaseModel):
    dtstart_local: str = ""
    dtend_local: str = ""


class PositionImageResponse(PositionFields):
    source_image_url: str | None = None


class EventFormDataResponse(BaseModel):
    title: str = ""
    description: str = ""
    occurrences: list[EventFormOccurrenceResponse] = Field(default_factory=list)
    location: str = ""
    category: str = ""
    price: float = 0
    food: list[str] = Field(default_factory=list)
    registration: bool = False
    source_image_url: str | None = None
