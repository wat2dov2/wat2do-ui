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
    requiresRegistration: bool = False


class EventFormDataResponse(BaseModel):
    title: str = ""
    description: str = ""
    date: str = ""
    time: str = "12:00"
    location: str = ""
    category: str = ""
    price: float = 0
    food: list[str] = []
    requiresRegistration: bool = False
    organization: str = ""
