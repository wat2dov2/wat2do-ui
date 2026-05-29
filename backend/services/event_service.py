"""Events via Supabase. Sync so no asyncpg/SQLAlchemy.

Events store metadata (title, location, image, etc.); occurrence dates
live in event_dates and are managed via event_date_service. The
``primary occurrence`` fields ``dtstart_utc`` / ``dtend_utc`` on response
models are computed by ``_pick_primary`` — earliest future occurrence, or
earliest occurrence if all are in the past.
"""

import logging
from datetime import datetime, timezone

from core.constants import DEFAULT_LIST_LIMIT, EVENT_STATUS_ACTIVE
from core.database import get_sb
from core.errors import EVENT_ALREADY_PAST
from core.exceptions import ValidationError
from core.pagination import fetch_all_pages
from core.retry import supabase_retry
from core.sanitize import sanitize_postgrest_value
from core.tables import EVENT_DATES, EVENTS
from schemas.event import (
    EventCreate,
    EventResponse,
    EventSummaryResponse,
    EventUpdate,
    LatestEventResponse,
)
from schemas.event_date import OccurrenceResponse
from services import event_date_service
from recommender.service import invalidate_candidates_cache

log = logging.getLogger(__name__)

EVENT_SUMMARY_EVENT_COLUMNS = ",".join(
    field
    for field in EventSummaryResponse.model_fields
    if field not in {"dtstart_utc", "dtend_utc"}
)

# Event fields whose changes constitute a "material" update — the ones
# worth notifying saved-by users about. Description/title/handle edits
# are deliberately excluded so routine cleanup does not fire alerts.
#
# ``occurrences`` covers what used to be two separate fields
# (``dtstart_utc`` + ``dtend_utc``); the diff helper compares the full
# list so adding / removing / reshuffling occurrences all show up.
MATERIAL_FIELDS: tuple[str, ...] = (
    "occurrences",
    "location",
    "status",
)


# ── Internal helpers ──────────────────────────────────────────────────


def _pick_primary(occurrences: list[OccurrenceResponse]) -> OccurrenceResponse | None:
    """Return the occurrence the API exposes as the "primary" date.

    Earliest future occurrence wins; if every occurrence is in the past,
    fall back to the earliest one so the event still has a date label
    (matches the v1 behaviour where the events table always carried a
    dtstart even after the event ended).
    """
    if not occurrences:
        return None
    now = datetime.now(timezone.utc)
    future = [o for o in occurrences if _to_utc(o.dtstart_utc) >= now]
    pool = future or list(occurrences)
    pool.sort(key=lambda o: _to_utc(o.dtstart_utc))
    return pool[0]


def _to_utc(dt: datetime | None) -> datetime:
    """Return a UTC-aware datetime, treating naive values as UTC."""
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _hydrate_response(row: dict, occurrences: list[OccurrenceResponse]) -> EventResponse:
    """Build an EventResponse from a raw events row + its occurrences.

    The events row does not carry ``dtstart_utc`` / ``dtend_utc``; those
    are derived from the primary occurrence for card/list rendering.
    """
    primary = _pick_primary(occurrences)
    payload = dict(row)
    payload["occurrences"] = [o.model_dump(mode="json") for o in occurrences]
    payload["dtstart_utc"] = primary.dtstart_utc.isoformat() if primary else None
    payload["dtend_utc"] = primary.dtend_utc.isoformat() if primary and primary.dtend_utc else None
    return EventResponse.model_validate(payload)


def _hydrate_summary(row: dict, occurrences: list[OccurrenceResponse]) -> EventSummaryResponse:
    """Build an EventSummaryResponse with the primary occurrence's date.

    Summary and detail responses share this primary-date computation so
    a multi-occurrence event has one consistent card date everywhere.
    """
    primary = _pick_primary(occurrences)
    payload = dict(row)
    payload["dtstart_utc"] = primary.dtstart_utc.isoformat() if primary else None
    payload["dtend_utc"] = primary.dtend_utc.isoformat() if primary and primary.dtend_utc else None
    return EventSummaryResponse.model_validate(payload)


# ── Public functions ──────────────────────────────────────────────────


@supabase_retry
def get_latest_added_event() -> LatestEventResponse | None:
    """Return the most recently added event (by added_at desc), or None if no events."""
    r = (
        get_sb()
        .table(EVENTS)
        .select("title,added_at")
        .order("added_at", desc=True)
        .limit(1)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return None
    return LatestEventResponse.model_validate(r.data[0])


@supabase_retry
def get_event(event_id: int) -> EventResponse | None:
    r = get_sb().table(EVENTS).select("*").eq("id", event_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    occurrences = event_date_service.list_for_event(event_id)
    return _hydrate_response(r.data[0], occurrences)


@supabase_retry
def list_events(
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    category: str | None = None,
    club_type: str | None = None,
    school: str | None = None,
    search: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    has_food: bool | None = None,
    max_price: float | None = None,
    registration: bool | None = None,
    summary: bool = False,
    include_cancelled: bool = False,
) -> list[EventSummaryResponse] | list[EventResponse]:
    """List events with optional filters.

    Events are queried through event_dates directly using resource embedding
    inner joins. This replaces the legacy two-stage client-side filter query
    with a single, efficient, paginated database query.
    """
    select_cols = EVENT_SUMMARY_EVENT_COLUMNS if summary else "*"
    q = (
        get_sb()
        .table(EVENT_DATES)
        .select(f"event_id,dtstart_utc,dtend_utc,tz,events!inner({select_cols})")
    )

    # Apply event filters prefixed with 'events.'
    if not include_cancelled:
        q = q.eq("events.status", EVENT_STATUS_ACTIVE)
    if category:
        q = q.eq("events.category", category)
    if club_type:
        q = q.eq("events.club_type", club_type)
    if school:
        q = q.eq("events.school", school)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            quoted = f'"%{term}%"'
            columns = ("title", "description", "location", "organization")
            q = q.or_(",".join(f"{col}.ilike.{quoted}" for col in columns), reference_table="events")
    if has_food is True:
        q = q.not_.is_("events.food", "null").neq("events.food", "[]")
    if max_price is not None:
        safe_price = f"{max_price:.6f}"
        q = q.or_(f"price.is.null,price.lte.{safe_price}", reference_table="events")
    if registration is not None:
        q = q.eq("events.registration", registration)

    # Apply date range filters on event_dates directly
    if from_date:
        q = q.gte("dtstart_utc", from_date.isoformat())
    if to_date:
        q = q.lte("dtstart_utc", to_date.isoformat())

    # Order by occurrence date desc to preserve the browse order.
    # Paginate using skip/limit over occurrences.
    q = q.order("dtstart_utc", desc=True).range(skip, skip + limit * 5 - 1)
    rows = q.execute().data or []

    # De-dup: one row per event id, keep the first occurrence-row we
    # see (which is the highest dtstart_utc thanks to the desc sort).
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in rows:
        event_row = row.get("events")
        if not event_row:
            continue
        rid = event_row.get("id")
        if rid is None or rid in seen:
            continue
        seen.add(rid)
        deduped.append(event_row)
        if len(deduped) >= limit:
            break

    # Both summary and detail paths fetch the full occurrence list for
    # each event so the primary-date computation (``_pick_primary``)
    # agrees across endpoints.
    event_ids = [row["id"] for row in deduped]
    occ_by_event = event_date_service.list_for_events(event_ids)

    if summary:
        return [_hydrate_summary(row, occ_by_event.get(row["id"], [])) for row in deduped]
    return [_hydrate_response(row, occ_by_event.get(row["id"], [])) for row in deduped]



def create_event(data: EventCreate, *, created_by: str) -> EventResponse:
    payload = data.model_dump(mode="json")
    payload.pop("occurrences", None)
    payload["created_by"] = created_by
    r = get_sb().table(EVENTS).insert(payload).execute()
    new_row = r.data[0]
    new_id = new_row["id"]

    try:
        event_date_service.create_occurrences(new_id, data.occurrences)
    except Exception:
        # Roll back the orphan event row if occurrence insert failed —
        # PostgREST has no transaction surface, so we clean up manually.
        get_sb().table(EVENTS).delete().eq("id", new_id).execute()
        raise

    occ_rows = event_date_service.list_for_event(new_id)
    invalidate_candidates_cache()
    return _hydrate_response(new_row, occ_rows)


def has_ended(event: EventResponse, *, now: datetime | None = None) -> bool:
    """Return True if every occurrence on the event is strictly in the past.

    For multi-occurrence events, we use the LATEST occurrence's end time
    as the "event still in flight" boundary — an event with one occurrence
    last week and one next week is not yet "ended". Events with no
    occurrences are treated as always-mutable (legacy rows).
    """
    if not event.occurrences:
        return False
    current = now or datetime.now(timezone.utc)
    latest_end = max(_to_utc(o.dtend_utc or o.dtstart_utc) for o in event.occurrences)
    return latest_end < current


def update_event(event_id: int, data: EventUpdate) -> EventResponse | None:
    """Update an event, refusing edits to already-past events.

    Past-event freezing (audit I12) — once every occurrence has passed,
    mutations are rejected. This prevents owners from silently rewriting
    title / dtstart / organization on an event users already saved.
    """
    existing = get_event(event_id)
    if existing is None:
        return None
    if has_ended(existing):
        log.warning(
            "Rejected update to past event id=%s (last occurrence ended)",
            event_id,
        )
        raise ValidationError(EVENT_ALREADY_PAST)

    payload = data.model_dump(mode="json", exclude_unset=True)
    new_occurrences = payload.pop("occurrences", None)

    if payload:
        get_sb().table(EVENTS).update(payload).eq("id", event_id).execute()

    if new_occurrences is not None and data.occurrences is not None:
        event_date_service.replace_occurrences(event_id, data.occurrences)

    invalidate_candidates_cache()
    return get_event(event_id)


def delete_event(event_id: int) -> bool:
    # C6: event_promotions.event_id has ON DELETE CASCADE, so any active
    # paid promotion on this event would silently disappear when the row
    # is deleted. Prorate-refund the unused portion first (via the ledger
    # so the audit trail stays correct) before dropping the event. The
    # refund helper logs per-row failures and never raises, so a single
    # bad promotion row cannot block the deletion. event_dates also
    # cascade-delete via FK, so we don't have to clean them up manually.
    from services import credit_service  # local import to avoid cycle

    try:
        credit_service.refund_active_promotions_for_event(event_id)
    except Exception as e:
        log.error(
            "refund_active_promotions_for_event failed for event=%s: %s",
            event_id,
            e,
        )

    r = get_sb().table(EVENTS).delete().eq("id", event_id).execute()
    if r.data:
        invalidate_candidates_cache()
    return bool(r.data)


def compute_event_diff(
    old: EventResponse, new: EventResponse
) -> dict[str, dict[str, object | None]]:
    """Diff the subset of fields whose changes warrant a user-facing alert.

    Only ``MATERIAL_FIELDS`` are compared — routine title/description
    edits should not fire notifications. The ``occurrences`` field
    compares old vs new as ordered lists of dtstart/dtend/duration/tz
    tuples; the lists arrive sorted by ``dtstart_utc`` (because
    ``list_for_event`` orders ASC), so a pure reshuffle without any
    date change produces identical canonical lists and fires NO diff.
    A real change (added / removed / moved date) does fire.

    Returns an empty dict when no material field changed; callers can
    branch on truthiness.
    """
    diff: dict[str, dict[str, object | None]] = {}
    for field in MATERIAL_FIELDS:
        old_val = getattr(old, field, None)
        new_val = getattr(new, field, None)
        if field == "occurrences":
            old_jsonable = [_occurrence_jsonable(o) for o in (old_val or [])]
            new_jsonable = [_occurrence_jsonable(o) for o in (new_val or [])]
            if old_jsonable == new_jsonable:
                continue
            diff[field] = {"old": old_jsonable, "new": new_jsonable}
            continue
        if old_val == new_val:
            continue
        diff[field] = {
            "old": _jsonable(old_val),
            "new": _jsonable(new_val),
        }
    return diff


def _jsonable(value: object) -> object | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _occurrence_jsonable(occ: OccurrenceResponse) -> dict:
    """Stable, comparable shape for occurrence diffs.

    Strips ``id`` and ``created_at`` (DB metadata that changes on every
    ``replace_occurrences`` regardless of whether the underlying date
    moved). The remaining fields (dtstart_utc, dtend_utc, duration, tz)
    are what users actually care about being notified on.
    """
    return {
        "dtstart_utc": occ.dtstart_utc.isoformat(),
        "dtend_utc": occ.dtend_utc.isoformat() if occ.dtend_utc else None,
        "duration": occ.duration,
        "tz": occ.tz,
    }
