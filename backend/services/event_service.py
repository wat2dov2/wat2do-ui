"""Events via Supabase. Sync so no asyncpg/SQLAlchemy.

Events store metadata (title, location, image, etc.); occurrence dates
live in ``event_dates`` (via ``event_date_service``) and are returned on
response models as the ``occurrences`` list.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from postgrest.exceptions import APIError

from core.constants import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from core.database import get_sb
from core.errors import EVENT_ALREADY_PAST, ORGANIZATION_NOT_FOUND
from core.exceptions import NotFoundError, ValidationError
from core.pagination import fetch_all_pages
from core.retry import supabase_retry
from core.tables import EVENTS
from schemas.event import (
    EventCreate,
    EventResponse,
    EventStatsResponse,
    EventSummaryResponse,
    EventUpdate,
    LatestEventResponse,
)
from schemas.event_date import OccurrenceResponse, OccurrenceUpdate
from schemas.organization import OrganizationEventStats
from services import (
    event_date_service,
    event_query,
    going_event_service,
    interaction_service,
    school_service,
)
from services.event_feed_revalidation import event_feed_revalidation_service
from services.school_context import resolve_school_timezone

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EventUpdateResult:
    event: EventResponse
    recipient_ids: list[UUID]


# Event fields whose changes constitute a "material" update - the ones
# worth notifying saved-by users about. Description/title/handle edits
# are deliberately excluded so routine cleanup does not fire alerts.
#
# ``occurrences`` covers what used to be two separate fields
# (``dtstart_utc`` + ``dtend_utc``); the diff helper compares the full
# list so adding / removing / reshuffling occurrences all show up.
MATERIAL_FIELDS: tuple[str, ...] = (
    "occurrences",
    "location",
    "cancelled",
)


# ── Internal helpers ──────────────────────────────────────────────────


def _to_utc(dt: datetime | None) -> datetime:
    """Return a UTC-aware datetime, treating naive values as UTC."""
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_organization_fields(organization_id: int) -> dict[str, str | int | None]:
    """Derive the event's denormalized fields from its owning organization.

    The organization is the single source of truth for an event's display name
    and school - callers never set these directly, so both the
    direct-create path and the submission-approval path stay in agreement.
    """
    from services import organization_service  # local import avoids an import cycle

    organization = organization_service.get_organization(organization_id)
    if organization is None:
        raise NotFoundError(ORGANIZATION_NOT_FOUND)
    school_id = organization.school_id or school_service.get_school_id(organization.school)
    if school_id is None:
        raise ValidationError("Organization school is not registered")
    return {
        "organization": organization.organization_name,
        "school_id": school_id,
    }


# ── Public functions ──────────────────────────────────────────────────


@supabase_retry
def get_latest_added_event(school: str | None = None) -> LatestEventResponse | None:
    """Return the most recently added event (by added_at desc), or None if no events."""
    q = get_sb().table(EVENTS).select("title,added_at")
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return None
        q = q.eq("school_id", school_id)
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
    r = (
        get_sb()
        .table(EVENTS)
        .select(f"*,{event_query.ORGANIZATION_EMBED},{event_query.SCHOOL_EMBED}")
        .eq("id", event_id)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return None
    occurrences = event_date_service.list_for_event(event_id)
    return event_query.hydrate_event(r.data[0], occurrences, EventResponse)


def get_event_stats_for_school(school: str | None) -> dict[str, EventStatsResponse]:
    """Return uncached click and going counts for cards at one school.

    ``school`` of ``None`` is the all-schools view: every card, unfiltered.
    """

    def _page(offset: int, page_size: int) -> list[dict]:
        q = get_sb().table(EVENTS).select("id")
        if school:
            school_id = school_service.get_school_id(school)
            if school_id is None:
                return []
            q = q.eq("school_id", school_id)
        return q.range(offset, offset + page_size - 1).execute().data or []

    event_rows = fetch_all_pages(_page)
    event_ids = [int(row["id"]) for row in event_rows]
    click_counts = interaction_service.get_click_counts_for_events(event_ids)
    try:
        going_counts = going_event_service.get_going_counts_for_events(event_ids)
    except APIError as exc:
        log.warning("Failed to fetch event going counts: %s", exc)
        going_counts = {}

    return {
        str(event_id): EventStatsResponse(
            click_count=click_counts.get(event_id, 0),
            going_count=going_counts.get(event_id, 0),
        )
        for event_id in event_ids
        if click_counts.get(event_id, 0) > 0 or going_counts.get(event_id, 0) > 0
    }


def _today_start_utc(school: str | None) -> datetime:
    """Start of the current day, in the school's timezone, as a UTC instant.

    "Upcoming" means "starts today or later" - using the school's local day
    boundary (not UTC midnight) so events earlier today don't drop out for
    users a few hours off UTC.
    """
    tz = ZoneInfo(resolve_school_timezone(school))
    local_midnight = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(timezone.utc)


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
    added_within_24h: bool = False,
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
        added_within_24h=added_within_24h,
    )


def list_promoted_events(school: str | None = None) -> list[EventSummaryResponse]:
    """Return upcoming promoted events for a school."""
    from services import credit_service

    active_ids = credit_service.get_active_promoted_event_ids()
    if not active_ids:
        return []
    promoted, _ = list_events(
        school=school,
        limit=MAX_LIST_LIMIT,
        ids=active_ids,
    )
    return promoted


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
        # Roll back the orphan event row if occurrence insert failed -
        # PostgREST has no transaction surface, so we clean up manually.
        get_sb().table(EVENTS).delete().eq("id", new_id).execute()
        raise

    created = get_event(new_id)
    if created is None:
        raise APIError("Failed to read created event")
    event_feed_revalidation_service.revalidate_school(created.school)
    return created


def has_ended(event: EventResponse, *, now: datetime | None = None) -> bool:
    """Return True if every occurrence on the event is strictly in the past.

    For multi-occurrence events, we use the LATEST occurrence's end time
    as the "event still in flight" boundary - an event with one occurrence
    last week and one next week is not yet "ended". Events with no
    occurrences are treated as already ended because current events are
    required to have at least one occurrence.
    """
    if not event.occurrences:
        return True
    current = now or datetime.now(timezone.utc)
    latest_end = max(_to_utc(o.dtend_utc or o.dtstart_utc) for o in event.occurrences)
    return latest_end < current


def update_event(event_id: int, data: EventUpdate) -> EventUpdateResult | None:
    """Update an event, refusing edits to already-past events.

    Past-event freezing (audit I12) - once every occurrence has passed,
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

    recipient_ids = update_event_and_occurrences(
        event_id,
        payload,
        data.occurrences if new_occurrences is not None else None,
    )

    updated = get_event(event_id)
    if updated is not None:
        event_feed_revalidation_service.revalidate_schools([existing.school, updated.school])
        return EventUpdateResult(
            event=updated,
            recipient_ids=recipient_ids,
        )
    return None


def update_event_and_occurrences(
    event_id: int,
    event_patch: dict,
    occurrences: list[OccurrenceUpdate] | None,
) -> list[UUID]:
    """Apply an event patch and stable occurrence set through the transaction RPC."""
    response = (
        get_sb()
        .rpc(
            "update_event_with_occurrences",
            {
                "p_event_id": event_id,
                "p_event_patch": event_patch,
                "p_occurrences": (
                    [
                        occurrence.model_dump(mode="json", exclude_none=False)
                        for occurrence in occurrences
                    ]
                    if occurrences is not None
                    else None
                ),
            },
        )
        .execute()
    )
    result_row = response.data[0] if response.data else {}
    return [UUID(str(user_id)) for user_id in result_row.get("recipient_ids") or []]


def delete_event(event_id: int) -> bool:
    # C6: refund active promotions before delete - ON DELETE CASCADE would
    # otherwise drop them without a ledger refund. Helper never raises.
    # event_dates cascade via FK.
    from services import credit_service  # local import to avoid cycle

    try:
        credit_service.refund_active_promotions_for_event(event_id)
    except Exception as e:
        log.error(
            "refund_active_promotions_for_event failed for event=%s: %s",
            event_id,
            e,
        )

    existing = get_event(event_id)
    r = get_sb().table(EVENTS).delete().eq("id", event_id).execute()
    if r.data:
        event_feed_revalidation_service.revalidate_school(
            existing.school if existing is not None else None
        )
    return bool(r.data)


def compute_event_diff(
    old: EventResponse, new: EventResponse
) -> dict[str, dict[str, object | None]]:
    """Diff the subset of fields whose changes warrant a user-facing alert.

    Only ``MATERIAL_FIELDS`` are compared - routine title/description
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

    Strips ``id`` and ``created_at`` because they are database metadata.
    The remaining fields (dtstart_utc, dtend_utc, duration, tz) are what
    users actually care about being notified on.
    """
    return {
        "dtstart_utc": occ.dtstart_utc.isoformat(),
        "dtend_utc": occ.dtend_utc.isoformat() if occ.dtend_utc else None,
        "duration": occ.duration,
        "tz": occ.tz,
    }
