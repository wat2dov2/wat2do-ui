"""Hydrated event reads for Python callers.

The public feed, event detail and the rest of the event API are served by the
Rust API (``rust/src/api/events``). Python keeps the reads its own jobs need:
events by id (the Instagram carousel) and the upcoming candidate pool
(``recommender``), in the same shape and order the feed serves.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from itertools import batched
from typing import TypeVar

from pydantic import BaseModel

from core.database import get_sb
from core.tables import EVENT_DATES, EVENTS, INSTAGRAM_PUBLISH_ITEMS
from schemas.event import EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service, school_service
from services.ingestion import directory

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Columns the summary response needs from the events table. Computed fields are
# filled after fetch and must not be sent to PostgREST as real column names.
# The club link/social fields are hydrated from the embedded
# ``clubs`` row (see ``CLUB_EMBED``), not real events columns.
_SUMMARY_COMPUTED_FIELDS = {
    "occurrences",
    "cohosts",
    "school",
    "club_logo_url",
    "is_directory_event",
    "featured",
    "club_type",
    "club_page",
    "club_ig",
    "club_discord",
}
_SUMMARY_COLUMNS = ",".join(
    [
        *(f for f in EventSummaryResponse.model_fields if f not in _SUMMARY_COMPUTED_FIELDS),
        "ingestion_source",
    ]
)
# Read-time embed of the owning club's display/link/social fields via the
# ``events.club_id`` FK, flattened onto the event in ``hydrate_event``.
CLUB_EMBED = "clubs(logo_url,club_type,club_page,ig,discord),cohosts:event_cohosts(id,club_name,logo_url,club_type,club_page,ig,discord)"
SCHOOL_EMBED = "school_record:schools(slug,timezone)"
INSTAGRAM_ITEMS_EMBED = f"{INSTAGRAM_PUBLISH_ITEMS}(published_at,instagram_publish_batches(status))"
_LIGHTWEIGHT_DATE_COLUMNS = "id,event_id,dtstart_utc,events!inner(id)"
_LIGHTWEIGHT_DATE_SCAN_CHUNK_SIZE = 250


def _order_event_date_rows(query):
    """Apply the canonical event-date feed order.

    ``dtstart_utc`` is the user-visible ordering key. ``event_id`` and the
    event-date row ``id`` make ties deterministic for offset pagination.
    """
    return (
        query.order("dtstart_utc", desc=False).order("event_id", desc=False).order("id", desc=False)
    )


def hydrate_event(row: dict, occurrences: list[OccurrenceResponse], model: type[T]) -> T:
    """Combine a raw ``events`` row with its occurrences into a response model.

    The one place that knows how an events row + occurrence list become an API
    model - shared by event detail, carousel slides and recommender candidates so
    the shape never drifts between them (the Rust API mirrors it).

    When the row carries an embedded ``clubs`` object (from
    ``CLUB_EMBED``), its type/link/social fields are flattened onto the
    event so the card badge can render them without a second fetch. Rows without
    the embed (e.g. the single-event ``select("*")`` path) are left unchanged.
    """
    row = school_service.with_school_slug(row)
    items = row.pop(INSTAGRAM_PUBLISH_ITEMS, None) or []
    featured = any(
        item.get("published_at")
        or (item.get("instagram_publish_batches") or {}).get("status") == "published"
        for item in items
    )
    org = row.pop("clubs", None)
    org_fields = (
        {
            "club_logo_url": org.get("logo_url"),
            "club_type": org.get("club_type"),
            "club_page": org.get("club_page"),
            "club_ig": org.get("ig"),
            "club_discord": org.get("discord"),
        }
        if isinstance(org, dict)
        else {}
    )
    is_directory_event = row.pop("ingestion_source", None) == "directory"
    # An event hosted by the university itself (no club) never borrows the student
    # union's logo: it shows its own poster or the plain fallback instead.
    if (
        is_directory_event
        and row.get("club_id") is not None
        and not org_fields.get("club_logo_url")
    ):
        org_fields["club_logo_url"] = directory.default_club_logo(
            row.get("school"), row.get("source_url")
        )
    return model.model_validate(
        {
            **row,
            **org_fields,
            "occurrences": occurrences,
            "is_directory_event": is_directory_event,
            "featured": featured,
        }
    )


def _load_event_rows_by_ids(event_ids: list[int], *, columns: str) -> list[dict]:
    """Load event rows in caller order, chunking PostgREST ``in`` filters."""
    rows_by_id: dict[int, dict] = {}
    for chunk in batched(event_ids, 500):
        rows = (
            get_sb()
            .table(EVENTS)
            .select(f"{columns},{CLUB_EMBED},{SCHOOL_EMBED},{INSTAGRAM_ITEMS_EMBED}")
            .in_("id", list(chunk))
            .execute()
            .data
            or []
        )
        rows_by_id.update({int(row["id"]): row for row in rows})
    return [rows_by_id[event_id] for event_id in event_ids if event_id in rows_by_id]


def _load_hydrated_events_by_ids(event_ids: list[int], *, model: type[T]) -> dict[int, T]:
    """Load event rows and occurrences concurrently, then hydrate by ID."""
    if not event_ids:
        return {}

    columns = _SUMMARY_COLUMNS if model is EventSummaryResponse else "*"
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows_future = pool.submit(_load_event_rows_by_ids, event_ids, columns=columns)
        occurrences_future = pool.submit(event_date_service.list_for_events, event_ids)
        rows = rows_future.result()
        occurrences_by_event = occurrences_future.result()

    return {
        int(row["id"]): hydrate_event(
            row,
            occurrences_by_event.get(row["id"], []),
            model,
        )
        for row in rows
    }


def load_events_by_ids(event_ids: list[int], *, model: type[T]) -> dict[int, T]:
    """Hydrated events for an explicit id list, keyed by id.

    For callers that already know which events they want - the Instagram
    carousel names its slides by event id - so they get the same hydrated
    shape the browse list serves rather than a hand-rolled select.
    """
    return _load_hydrated_events_by_ids(event_ids, model=model)


def load_upcoming_events(
    *, since: datetime, school: str | None, cap: int, model: type[T]
) -> list[T]:
    """Events with an occurrence at/after ``since``, deduped and hydrated.

    Ordered soonest-first and capped at ``cap`` distinct events, so the nearest
    events survive if a school has more upcoming than the cap. ``model`` selects
    the response shape (and, with it, how many event columns we fetch).
    """
    event_ids = load_upcoming_event_ids(since=since, school=school, cap=cap)
    if not event_ids:
        return []

    events_by_id = _load_hydrated_events_by_ids(event_ids, model=model)
    return [events_by_id[event_id] for event_id in event_ids if event_id in events_by_id]


def load_upcoming_event_ids(*, since: datetime, school: str | None, cap: int) -> list[int]:
    """Read the feed's upcoming IDs without hydrating event cards or occurrences."""
    school_id = school_service.get_school_id(school) if school else None
    if school and school_id is None:
        return []
    return _load_lightweight_date_page_ids(
        start_utc=since,
        end_utc=None,
        school_id=school_id,
        offset=0,
        limit=cap,
        cap=cap,
    )


def _load_lightweight_date_page_ids(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school_id: int | None,
    offset: int,
    limit: int,
    cap: int,
) -> list[int]:
    """Load only enough ordered event IDs to cover the requested page."""

    required_distinct = min(cap, offset + limit)
    if required_distinct <= offset:
        return []

    max_scan_rows = cap * 5
    scan_start = 0
    ordered_ids: list[int] = []
    seen: set[int] = set()
    while scan_start < max_scan_rows and len(ordered_ids) < required_distinct:
        scan_end = min(scan_start + _LIGHTWEIGHT_DATE_SCAN_CHUNK_SIZE, max_scan_rows) - 1
        rows = _query_lightweight_date_rows(
            start_utc=start_utc,
            end_utc=end_utc,
            school_id=school_id,
            range_start=scan_start,
            range_end=scan_end,
        )
        _append_deduped_event_ids(ordered_ids, seen, rows, cap)
        if len(rows) < scan_end - scan_start + 1:
            break
        scan_start = scan_end + 1

    return ordered_ids[offset : offset + limit]


def _query_lightweight_date_rows(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school_id: int | None,
    range_start: int,
    range_end: int,
) -> list[dict]:
    q = get_sb().table(EVENT_DATES).select(_LIGHTWEIGHT_DATE_COLUMNS)
    if start_utc is not None:
        q = q.gte("dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte("dtstart_utc", end_utc.isoformat())
    if school_id is not None:
        q = q.eq("events.school_id", school_id)
    return _order_event_date_rows(q).range(range_start, range_end).execute().data or []


def _append_deduped_event_ids(
    ordered_ids: list[int],
    seen: set[int],
    rows: list[dict],
    cap: int,
) -> None:
    """Append unseen event IDs from occurrence rows, preserving first occurrence order."""

    for row in rows:
        event_id = row.get("event_id")
        if event_id is None:
            event_row = row.get("events") or {}
            event_id = event_row.get("id")
        if event_id is None or event_id in seen:
            continue
        seen.add(event_id)
        ordered_ids.append(event_id)
        if len(ordered_ids) >= cap:
            break
