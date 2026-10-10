"""Official school event directories crawled by the local ingestion scraper."""

from typing import Literal

from pydantic import BaseModel


class DirectorySource(BaseModel):
    id: int
    school: str
    name: str
    url: str
    default_club: str
    default_club_ig: str | None = None
    source_format: Literal["html", "ical", "json"]
    event_url_patterns: list[str]
    event_url_exclude_patterns: list[str] = []
    json_url_fields: list[str] = ["url"]
    next_page_selector: str | None = None
    content_selector: str | None = None
    image_selector: str | None = None
