"""CRUD for event_dates rows.

Used by event_service.create_event / update_event when a payload carries
nested occurrences, and by services/wat2do/event_writer when the scraper
extracts a multi-occurrence event from one Instagram post.

Functions are intentionally thin — the events row is created/updated by
event_service first, then the occurrence list is bulk-inserted here.
PostgREST has no cross-table transaction support, so the orchestrator
in event_service is responsible for cleaning up an orphan event row if
the occurrence insert fails.
"""

import logging

from core.database import get_sb
from core.tables import EVENT_DATES
from schemas.event_date import OccurrenceCreate, OccurrenceResponse

log = logging.getLogger(__name__)


def create_occurrences(
    event_id: int, occurrences: list[OccurrenceCreate]
) -> list[OccurrenceResponse]:
    """Bulk-insert occurrences for ``event_id``.

    Empty input is a no-op (returns ``[]``). Caller is responsible for
    enforcing "at least one occurrence per event" at the schema layer
    (``EventCreate.occurrences`` is min_length=1).
    """
    if not occurrences:
        return []
    payload = []
    for occ in occurrences:
        row = occ.model_dump(mode="json")
        row["event_id"] = event_id
        payload.append(row)
    r = get_sb().table(EVENT_DATES).insert(payload).execute()
    return [OccurrenceResponse.model_validate(d) for d in (r.data or [])]


def replace_occurrences(
    event_id: int, occurrences: list[OccurrenceCreate]
) -> list[OccurrenceResponse]:
    """Atomically replace the occurrence list for ``event_id``.

    DELETE-then-INSERT — PostgREST has no real transaction surface, so
    a failure between the two leaves the event with no occurrences.
    Callers that care should check the returned list length.
    """
    get_sb().table(EVENT_DATES).delete().eq("event_id", event_id).execute()
    return create_occurrences(event_id, occurrences)


def list_for_event(event_id: int) -> list[OccurrenceResponse]:
    """All occurrences for one event, ordered by dtstart ascending."""
    r = (
        get_sb()
        .table(EVENT_DATES)
        .select("*")
        .eq("event_id", event_id)
        .order("dtstart_utc", desc=False)
        .execute()
    )
    return [OccurrenceResponse.model_validate(d) for d in (r.data or [])]


def list_for_events(event_ids: list[int]) -> dict[int, list[OccurrenceResponse]]:
    """Batched fetch — returns a dict keyed by event_id.

    Used by list_events to attach occurrences to a page of event rows
    without an N+1 query. Empty input returns ``{}``.
    """
    if not event_ids:
        return {}
    r = (
        get_sb()
        .table(EVENT_DATES)
        .select("*")
        .in_("event_id", event_ids)
        .order("dtstart_utc", desc=False)
        .execute()
    )
    grouped: dict[int, list[OccurrenceResponse]] = {eid: [] for eid in event_ids}
    for d in r.data or []:
        eid = d.get("event_id")
        if eid in grouped:
            grouped[eid].append(OccurrenceResponse.model_validate(d))
    return grouped


def delete_for_event(event_id: int) -> None:
    """Drop every occurrence row for ``event_id``.

    Normally not needed — the FK on event_dates.event_id has ON DELETE
    CASCADE, so deleting an events row drops its occurrences. Exposed
    here for the rare case where we want to clear occurrences without
    deleting the event (event_service.update_event with empty
    occurrences).
    """
    get_sb().table(EVENT_DATES).delete().eq("event_id", event_id).execute()
