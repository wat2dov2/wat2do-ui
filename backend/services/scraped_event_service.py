"""Scraped events persistence."""

import uuid

from core.database import get_sb
from core.tables import SCRAPED_EVENTS
from schemas.scraped_event import ScrapedEventResponse


def create_scraped_event(
    event_id: int | None,
    source: str,
    raw_data: dict | None = None,
) -> ScrapedEventResponse:
    """Record a scraped event."""
    payload = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "source": source,
        "raw_data": raw_data,
    }
    r = get_sb().table(SCRAPED_EVENTS).insert(payload).execute()
    return ScrapedEventResponse.model_validate(r.data[0]) if r.data else ScrapedEventResponse(**payload)


def get_scraped_events() -> list[ScrapedEventResponse]:
    """Return all scraped events, newest first."""
    r = (
        get_sb()
        .table(SCRAPED_EVENTS)
        .select("*")
        .order("scraped_at", desc=True)
        .execute()
    )
    return [ScrapedEventResponse.model_validate(row) for row in (r.data or [])]
