"""Read helpers and create-only writes for event occurrence rows.

Updates use the transactional ``update_event_with_occurrences`` RPC owned by
``event_service`` so occurrence identity and Going cascades stay atomic.
"""

from core.database import get_sb
from core.tables import EVENT_DATES
from schemas.event_date import OccurrenceCreate, OccurrenceResponse


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
    """Batched fetch - returns a dict keyed by event_id.

    Used by list_events and the calendar feed to attach occurrences to
    a page of event rows without an N+1 query. Empty input returns
    ``{}``.

    Chunked on the IDs because PostgREST sends ``in_(...)`` as a comma-
    separated value in a query string. Past ~1000 ids the URL exceeds
    Supabase's ~8KB cap and the request fails with 414. ``MAX_GOING_EVENTS_PER_USER``
    is 10000, so calendar feeds for power users would hit this otherwise.
    """
    if not event_ids:
        return {}
    grouped: dict[int, list[OccurrenceResponse]] = {eid: [] for eid in event_ids}
    chunk_size = 500
    for start in range(0, len(event_ids), chunk_size):
        chunk = event_ids[start : start + chunk_size]
        r = (
            get_sb()
            .table(EVENT_DATES)
            .select("*")
            .in_("event_id", chunk)
            .order("dtstart_utc", desc=False)
            .execute()
        )
        for d in r.data or []:
            eid = d.get("event_id")
            if eid in grouped:
                grouped[eid].append(OccurrenceResponse.model_validate(d))
    return grouped


def list_by_ids(occurrence_ids: list[str]) -> list[OccurrenceResponse]:
    """Fetch only the requested occurrences, chunked for PostgREST URL limits."""
    unique_ids = list(dict.fromkeys(occurrence_ids))
    if not unique_ids:
        return []

    occurrences: list[OccurrenceResponse] = []
    for start in range(0, len(unique_ids), 500):
        chunk = unique_ids[start : start + 500]
        response = (
            get_sb().table(EVENT_DATES).select("*").in_("id", chunk).order("dtstart_utc").execute()
        )
        occurrences.extend(OccurrenceResponse.model_validate(row) for row in (response.data or []))
    return occurrences
