from pydantic import BaseModel, Field


class AIPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


class FilterStateResponse(BaseModel):
    searchQuery: str = ""
    categories: list[str] = []
    locations: list[str] = []
    foods: list[str] = []
    days: list[str] = []
    priceRange: dict[str, str] = {"min": "", "max": ""}
    dateRange: str = ""
    addedSince: str = ""
    registration: bool = False


class EventFormOccurrenceResponse(BaseModel):
    dtstart_local: str = ""
    dtend_local: str = ""


class EventFormDataResponse(BaseModel):
    title: str = ""
    description: str = ""
    occurrences: list[EventFormOccurrenceResponse] = Field(default_factory=list)
    location: str = ""
    category: str = ""
    price: float = 0
    food: list[str] = Field(default_factory=list)
    registration: bool = False
