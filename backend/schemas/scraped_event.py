from pydantic import BaseModel


class ScrapedEventCreate(BaseModel):
    event_id: int | None = None
    source: str
    raw_data: dict | None = None


class ScrapedEventResponse(BaseModel):
    id: str
    event_id: int | None = None
    source: str
    scraped_at: str
    raw_data: dict | None = None
