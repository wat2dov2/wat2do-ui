"""Scraped events persistence."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.tables import SCRAPED_EVENTS
from schemas.scraped_event import ScrapedEventResponse

log = logging.getLogger(__name__)


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
    if r.data:
        return ScrapedEventResponse.model_validate(r.data[0])
    # E9: the fallback constructor must supply ``scraped_at`` since the
    # DB default (``now()``) is not included in ``payload``.  Without this
    # Pydantic raises ``ValidationError("Field required: scraped_at")`` →
    # global handler returns 500.  Matches the pattern used by
    # submission_service / report_service.
    log.warning(
        "Insert returned no data for create_scraped_event(source=%s), using payload fallback",
        source,
    )
    return ScrapedEventResponse(**payload, scraped_at=datetime.now(timezone.utc))


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
