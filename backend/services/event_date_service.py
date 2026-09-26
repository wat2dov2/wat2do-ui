"""Read helpers and create-only writes for event occurrence rows.

Updates use the transactional ``update_event_with_occurrences`` RPC owned by
``event_service`` so occurrence identity and Going cascades stay atomic.
"""

from itertools import batched

from core.database import get_sb
from core.tables import EVENT_DATES
from schemas.event_date import OccurrenceCreate, OccurrenceResponse

_OCCURRENCE_COLUMNS = ",".join(OccurrenceResponse.model_fields)


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
        .select(_OCCURRENCE_COLUMNS)
        .eq("event_id", event_id)
        .order("dtstart_utc", desc=False)
        .execute()
    )
    return [OccurrenceResponse.model_validate(d) for d in (r.data or [])]


def list_for_events(event_ids: list[int]) -> dict[int, list[OccurrenceResponse]]:
    """Group occurrences by event ID without per-event queries.

    Batch IDs to stay below PostgREST URL limits. Requested IDs with no
    occurrences retain empty lists.
    """
    if not event_ids:
        return {}
    grouped: dict[int, list[OccurrenceResponse]] = {eid: [] for eid in event_ids}
    for chunk in batched(event_ids, 500):
        r = (
            get_sb()
            .table(EVENT_DATES)
            .select(_OCCURRENCE_COLUMNS)
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
    for chunk in batched(unique_ids, 500):
        response = (
            get_sb()
            .table(EVENT_DATES)
            .select(_OCCURRENCE_COLUMNS)
            .in_("id", chunk)
            .order("dtstart_utc")
            .execute()
        )
        occurrences.extend(OccurrenceResponse.model_validate(row) for row in (response.data or []))
    return occurrences
