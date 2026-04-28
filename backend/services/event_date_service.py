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
    """Replace the occurrence list for ``event_id`` with snapshot rollback.

    PostgREST has no real transaction surface, so a naive
    DELETE-then-INSERT leaves the event with zero occurrences if the
    INSERT fails. We snapshot the existing rows first; on INSERT
    failure we re-insert the snapshot and re-raise so the caller knows
    the operation didn't take effect. The window between DELETE and
    re-INSERT-of-snapshot is tiny, but at least the event ends up
    either with the new occurrences or with the original ones — never
    silently empty.
    """
    snapshot = list_for_event(event_id)
    sb = get_sb()
    sb.table(EVENT_DATES).delete().eq("event_id", event_id).execute()
    try:
        return create_occurrences(event_id, occurrences)
    except Exception:
        # Best-effort restore from snapshot. If this also fails the
        # event is left empty — but at least we logged loudly.
        if snapshot:
            try:
                payload = []
                for occ in snapshot:
                    payload.append({
                        "event_id": event_id,
                        "dtstart_utc": occ.dtstart_utc.isoformat(),
                        "dtend_utc": occ.dtend_utc.isoformat() if occ.dtend_utc else None,
                        "duration": occ.duration,
                        "tz": occ.tz,
                    })
                sb.table(EVENT_DATES).insert(payload).execute()
                log.warning(
                    "replace_occurrences for event_id=%s failed; "
                    "restored %d original occurrence(s) from snapshot",
                    event_id, len(snapshot),
                )
            except Exception as restore_err:
                log.error(
                    "replace_occurrences for event_id=%s failed AND "
                    "snapshot restore failed; event has no occurrences. "
                    "Restore error: %s",
                    event_id, restore_err,
                )
        raise


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

    Used by list_events and the calendar feed to attach occurrences to
    a page of event rows without an N+1 query. Empty input returns
    ``{}``.

    Chunked on the IDs because PostgREST sends ``in_(...)`` as a comma-
    separated value in a query string. Past ~1000 ids the URL exceeds
    Supabase's ~8KB cap and the request fails with 414. ``MAX_SAVED_EVENTS_PER_USER``
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


def delete_for_event(event_id: int) -> None:
    """Drop every occurrence row for ``event_id``.

    Normally not needed — the FK on event_dates.event_id has ON DELETE
    CASCADE, so deleting an events row drops its occurrences. Exposed
    here for the rare case where we want to clear occurrences without
    deleting the event (event_service.update_event with empty
    occurrences).
    """
    get_sb().table(EVENT_DATES).delete().eq("event_id", event_id).execute()
