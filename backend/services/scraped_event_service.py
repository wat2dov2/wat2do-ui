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


def get_scraped_events(
    *,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[ScrapedEventResponse], int]:
    """Return scraped events, newest first.

    Returns (items, total_count).  When *limit* is None the query is
    unbounded (legacy behaviour for non-paginated callers).
    """
    q = (
        get_sb()
        .table(SCRAPED_EVENTS)
        .select("*", count="exact")
        .order("scraped_at", desc=True)
    )
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = [ScrapedEventResponse.model_validate(row) for row in (r.data or [])]
    return items, r.count or len(items)
