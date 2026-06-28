"""Events via Supabase. Sync so no asyncpg/SQLAlchemy.

Events store metadata (title, location, image, etc.); occurrence dates
live in event_dates and are managed via event_date_service. The
``primary occurrence`` fields ``dtstart_utc`` / ``dtend_utc`` on response
models are computed by ``_pick_primary`` — earliest future occurrence, or
earliest occurrence if all are in the past.
"""

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from core.cache import TTLCache
from core.constants import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from core.database import get_sb
from core.errors import EVENT_ALREADY_PAST, ORGANIZATION_NOT_FOUND
from core.exceptions import NotFoundError, ValidationError
from core.retry import supabase_retry
from core.tables import EVENTS
from recommender.service import invalidate_candidates_cache
from schemas.event import (
    EventCreate,
    EventResponse,
    EventSummaryResponse,
    EventUpdate,
    LatestEventResponse,
)
from schemas.event_date import OccurrenceResponse
from schemas.organization import OrganizationEventStats
from services import event_date_service, event_query
from services.event_feed_revalidation import event_feed_revalidation_service
from services.school_context import resolve_school_timezone

log = logging.getLogger(__name__)

# Mirrors the recommender's _candidates_cache pattern: one in-process TTLCache
# per cached query, cleared on write. Short TTL is the real freshness guarantee
# — an in-process write (create/update/delete) clears the cache immediately via
# invalidate_events_cache(), but an out-of-process writer (the scraper job)
# can't reach it, so those writes self-heal within this window. Cheap because
# the keyspace is one entry per school.
_EVENTS_CACHE_TTL = 60
_events_cache = TTLCache(default_ttl=_EVENTS_CACHE_TTL)


def invalidate_events_cache() -> None:
    """Drop the cached upcoming-events lists.

    Called from every event write path so a freshly created / edited / deleted
    event shows up on the next browse without waiting for the TTL.
    """
    _events_cache.clear()


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
)


# ── Internal helpers ──────────────────────────────────────────────────


def _to_utc(dt: datetime | None) -> datetime:
    """Return a UTC-aware datetime, treating naive values as UTC."""
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_organization_fields(organization_id: int) -> dict[str, str | None]:
    """Derive the event's denormalized fields from its owning organization.

    The organization is the single source of truth for an event's display name,
    type, and school — callers never set these directly, so both the
    direct-create path and the submission-approval path stay in agreement.
    """
    from services import organization_service  # local import avoids an import cycle

    organization = organization_service.get_organization(organization_id)
    if organization is None:
        raise NotFoundError(ORGANIZATION_NOT_FOUND)
    return {
        "organization": organization.organization_name,
        "organization_type": organization.organization_type,
        "school": organization.school,
    }


# ── Public functions ──────────────────────────────────────────────────


@supabase_retry
def get_latest_added_event(school: str | None = None) -> LatestEventResponse | None:
    """Return the most recently added event (by added_at desc), or None if no events."""
    q = get_sb().table(EVENTS).select("title,added_at")
    if school:
        q = q.eq("school", school)
    r = q.order("added_at", desc=True).limit(1).execute()
    if not r.data or len(r.data) == 0:
        return None
    return LatestEventResponse.model_validate(r.data[0])


@supabase_retry
def get_organization_event_stats(
    organization_ids: list[int],
) -> dict[int, OrganizationEventStats]:
    """Return per-organization event totals and most recently added event."""
    if not organization_ids:
        return {}

    stats = {organization_id: OrganizationEventStats() for organization_id in organization_ids}

    r = (
        get_sb()
        .table(EVENTS)
        .select("organization_id,title,added_at")
        .in_("organization_id", organization_ids)
        .order("added_at", desc=True)
        .execute()
    )

    for row in r.data or []:
        organization_id = row.get("organization_id")
        if organization_id not in stats:
            continue

        current = stats[organization_id]
        current.event_count += 1
        if current.latest_event_title is None:
            current.latest_event_title = row.get("title")
            added_at = row.get("added_at")
            if added_at is not None:
                current.latest_event_added_at = (
                    added_at
                    if isinstance(added_at, datetime)
                    else datetime.fromisoformat(str(added_at).replace("Z", "+00:00"))
                )

    return stats


@supabase_retry
def get_event(event_id: int) -> EventResponse | None:
    r = get_sb().table(EVENTS).select("*").eq("id", event_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    occurrences = event_date_service.list_for_event(event_id)
    event_row = event_query.with_click_counts([r.data[0]])[0]
    return event_query.hydrate_event(event_row, occurrences, EventResponse)


def _today_start_utc(school: str | None) -> datetime:
    """Start of the current day, in the school's timezone, as a UTC instant.

    "Upcoming" means "starts today or later" — using the school's local day
    boundary (not UTC midnight) so events earlier today don't drop out for
    users a few hours off UTC.
    """
    tz = ZoneInfo(resolve_school_timezone(school))
    local_midnight = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(timezone.utc)


def _load_upcoming_events(school: str | None) -> list[EventSummaryResponse]:
    """Browse-list binding of the shared upcoming-events loader.

    "Upcoming" for the public list means "starts today or later" in the
    school's local day; the rest (dedup, hydrate, cap) is the shared query in
    ``event_query``. This all-upcoming loader is retained for promoted-event
    filtering; the public browse route uses ``list_events`` for server paging.
    """
    return event_query.load_upcoming_events(
        since=_today_start_utc(school),
        school=school,
        cap=MAX_LIST_LIMIT,
        model=EventSummaryResponse,
    )


def list_events(
    school: str | None = None,
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    start_utc: datetime | None = None,
    end_utc: datetime | None = None,
    search: str | None = None,
    categories: list[str] | None = None,
    locations: list[str] | None = None,
    foods: list[str] | None = None,
    days: list[str] | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    registration: bool | None = None,
    organizations: list[str] | None = None,
    free_food: bool = False,
    ids: list[int] | None = None,
    sort_by: str = "date",
    sort_order: str = "asc",
) -> tuple[list[EventSummaryResponse], int]:
    """Public browse list for a school.

    Returns a paged result plus total count. The default date lower bound is
    the school's local start-of-today, matching the historical upcoming list.
    """
    return event_query.load_events_page(
        start_utc=start_utc if start_utc is not None else _today_start_utc(school),
        end_utc=end_utc,
        school=school,
        offset=skip,
        limit=limit,
        cap=MAX_LIST_LIMIT,
        model=EventSummaryResponse,
        search=search,
        categories=categories,
        locations=locations,
        foods=foods,
        days=days,
        min_price=min_price,
        max_price=max_price,
        registration=registration,
        organizations=organizations,
        free_food=free_food,
        ids=ids,
        sort_by=sort_by,
        sort_order=sort_order,
    )


def list_promoted_events(school: str | None = None) -> list[EventSummaryResponse]:
    """Return upcoming promoted events for a school."""
    from services import credit_service

    active_ids = credit_service.get_active_promoted_event_ids()
    if not active_ids:
        return []
    all_upcoming = _events_cache.get_or_compute(
        school or "_all",
        lambda: _load_upcoming_events(school),
    )
    return [e for e in all_upcoming if e.id in active_ids]


def create_event(data: EventCreate, *, created_by: str) -> EventResponse:
    payload = data.model_dump(mode="json")
    payload.pop("occurrences", None)
    payload.update(_resolve_organization_fields(data.organization_id))
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
    invalidate_events_cache()
    event_feed_revalidation_service.revalidate_school(new_row.get("school"))
    return event_query.hydrate_event(new_row, occ_rows, EventResponse)


def has_ended(event: EventResponse, *, now: datetime | None = None) -> bool:
    """Return True if every occurrence on the event is strictly in the past.

    For multi-occurrence events, we use the LATEST occurrence's end time
    as the "event still in flight" boundary — an event with one occurrence
    last week and one next week is not yet "ended". Events with no
    occurrences are treated as already ended because current events are
    required to have at least one occurrence.
    """
    if not event.occurrences:
        return True
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

    # Reassigning the organization re-derives the denormalized display fields so the
    # event row never drifts from its owning organization.
    if payload.get("organization_id") is not None:
        payload.update(_resolve_organization_fields(payload["organization_id"]))

    if payload:
        get_sb().table(EVENTS).update(payload).eq("id", event_id).execute()

    if new_occurrences is not None and data.occurrences is not None:
        event_date_service.replace_occurrences(event_id, data.occurrences)

    invalidate_candidates_cache()
    invalidate_events_cache()
    updated = get_event(event_id)
    if updated is not None:
        event_feed_revalidation_service.revalidate_schools([existing.school, updated.school])
    return updated


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
        invalidate_events_cache()
        deleted = r.data[0] if isinstance(r.data[0], dict) else {}
        event_feed_revalidation_service.revalidate_school(deleted.get("school"))
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
