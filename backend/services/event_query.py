"""Single read path for "upcoming events with their occurrences".

Two callers need the same thing and must not drift apart:

- ``event_service.list_events`` — the public browse list for a school.
- ``recommender`` — the candidate pool for recommendations.

Both want events that still have an occurrence at or after some instant,
deduped to one row per event, hydrated with their occurrence list. That query
+ hydrate lives here exactly once, parameterized only by the bits that
legitimately differ between callers: the time bound, the school, the cap, and
the response model.
"""

import logging
from datetime import datetime
from typing import TypeVar

from pydantic import BaseModel

from core.database import get_sb
from core.retry import supabase_retry
from core.tables import EVENT_DATES
from schemas.event import EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Columns the summary response needs (everything except the occurrences we
# hydrate separately). The full response model just selects everything.
_SUMMARY_COLUMNS = ",".join(f for f in EventSummaryResponse.model_fields if f != "occurrences")


def hydrate_event(row: dict, occurrences: list[OccurrenceResponse], model: type[T]) -> T:
    """Combine a raw ``events`` row with its occurrences into a response model.

    The one place that knows how an events row + occurrence list become an API
    model — shared by the browse list, recommender candidates, and the calendar
    feed so the shape never drifts between them.
    """
    return model.model_validate(
        {**row, "occurrences": [o.model_dump(mode="json") for o in occurrences]}
    )


@supabase_retry
def load_upcoming_events(
    *, since: datetime, school: str | None, cap: int, model: type[T]
) -> list[T]:
    """Events with an occurrence at/after ``since``, deduped and hydrated.

    Ordered soonest-first and capped at ``cap`` distinct events, so the nearest
    events survive if a school has more upcoming than the cap. ``model`` selects
    the response shape (and, with it, how many event columns we fetch).
    """
    return load_events_in_window(
        start_utc=since,
        end_utc=None,
        school=school,
        cap=cap,
        model=model,
    )


@supabase_retry
def load_events_in_window(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school: str | None,
    cap: int,
    model: type[T],
) -> list[T]:
    """Events with an occurrence inside the requested UTC window.

    ``None`` bounds are open-ended. Results are deduped to one row per event,
    keeping the earliest matching occurrence for ordering and capping.
    """
    columns = _SUMMARY_COLUMNS if model is EventSummaryResponse else "*"
    q = (
        get_sb()
        .table(EVENT_DATES)
        .select(f"event_id,dtstart_utc,dtend_utc,tz,events!inner({columns})")
    )
    if start_utc is not None:
        q = q.gte("dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte("dtstart_utc", end_utc.isoformat())
    if school:
        q = q.eq("events.school", school)
    rows = q.order("dtstart_utc", desc=False).range(0, cap * 5 - 1).execute().data or []

    events = _dedup_keeping_earliest(rows, cap)
    occ_by_event = event_date_service.list_for_events([row["id"] for row in events])
    return [hydrate_event(row, occ_by_event.get(row["id"], []), model) for row in events]


def _dedup_keeping_earliest(rows: list[dict], cap: int) -> list[dict]:
    """One ``events`` row per id, keeping its earliest occurrence.

    Rows arrive sorted by ``dtstart_utc`` ascending, so the first time we see an
    event id it carries that event's soonest upcoming occurrence. Stops once
    ``cap`` distinct events are collected.
    """
    seen: set[int] = set()
    events: list[dict] = []
    for row in rows:
        event_row = row.get("events")
        if not event_row:
            continue
        rid = event_row.get("id")
        if rid is None or rid in seen:
            continue
        seen.add(rid)
        events.append(event_row)
        if len(events) >= cap:
            break
    return events
