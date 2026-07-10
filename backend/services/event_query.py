"""Single read path for "upcoming events with their occurrences".

Two callers need the same thing and must not drift apart:

- ``event_service.list_events`` - the public browse list for a school.
- ``recommender`` - the candidate pool for recommendations.

Both want events that still have an occurrence at or after some instant,
deduped to one row per event, hydrated with their occurrence list. That query
+ hydrate lives here exactly once, parameterized only by the bits that
legitimately differ between callers: the time bound, the school, the cap, and
the response model.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel

from core.database import get_sb
from core.retry import supabase_retry
from core.sanitize import sanitize_postgrest_value
from core.tables import EVENT_DATES, EVENTS
from schemas.event import EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Columns the summary response needs from the events table. Computed fields are
# filled after fetch and must not be sent to PostgREST as real column names.
# The organization link/social fields are hydrated from the embedded
# ``organizations`` row (see ``_ORGANIZATION_EMBED``), not real events columns.
_SUMMARY_COMPUTED_FIELDS = {
    "occurrences",
    "click_count",
    "organization_page",
    "organization_ig",
    "organization_discord",
}
_SUMMARY_COLUMNS = ",".join(
    f for f in EventSummaryResponse.model_fields if f not in _SUMMARY_COMPUTED_FIELDS
)
# Read-time embed of the owning organization's link/social fields via the
# ``events.organization_id`` FK, flattened onto the event in ``hydrate_event``.
_ORGANIZATION_EMBED = "organizations(organization_page,ig,discord)"
_LIGHTWEIGHT_DATE_COLUMNS = "id,event_id,dtstart_utc,events!inner(id)"
_LIGHTWEIGHT_DATE_SCAN_CHUNK_SIZE = 250


@dataclass
class _EventCandidate:
    row: dict
    earliest_dtstart: datetime | None
    weekdays: set[str] = field(default_factory=set)


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
    model - shared by the browse list, recommender candidates, and the calendar
    feed so the shape never drifts between them.

    When the row carries an embedded ``organizations`` object (from
    ``_ORGANIZATION_EMBED``), its link/social fields are flattened onto the
    event so the card badge can render them without a second fetch. Rows without
    the embed (e.g. the single-event ``select("*")`` path) are left unchanged.
    """
    org = row.pop("organizations", None)
    org_fields = (
        {
            "organization_page": org.get("organization_page"),
            "organization_ig": org.get("ig"),
            "organization_discord": org.get("discord"),
        }
        if isinstance(org, dict)
        else {}
    )
    return model.model_validate({**row, **org_fields, "occurrences": occurrences})


def with_click_counts(rows: list[dict]) -> list[dict]:
    """Return event rows enriched with their recorded click counts.

    Event rows are hydrated in several read paths. Keeping the enrichment here
    makes ``click_count`` a single API contract instead of a frontend-only
    guess or a per-route one-off.
    """

    event_ids = [row.get("id") for row in rows if row.get("id") is not None]
    click_counts = _fetch_click_counts(event_ids)
    return [
        {
            **row,
            "click_count": click_counts.get(_int_or_none(row.get("id")), 0),
        }
        for row in rows
    ]


def _fetch_click_counts(event_ids: list[object]) -> dict[int, int]:
    unique_ids = sorted(
        {event_id for raw_id in event_ids if (event_id := _int_or_none(raw_id)) is not None}
    )
    if not unique_ids:
        return {}

    try:
        rows = (
            get_sb().rpc("get_event_click_counts", {"p_event_ids": unique_ids}).execute().data or []
        )
    except Exception as exc:
        log.warning("Failed to fetch event click counts: %s", exc)
        return {}
    counts: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        event_id = row.get("event_id")
        click_count = row.get("click_count")
        if event_id is None or click_count is None:
            continue
        try:
            counts[int(event_id)] = int(click_count)
        except (TypeError, ValueError):
            continue
    return counts


def _int_or_none(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


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
        .select(f"event_id,dtstart_utc,dtend_utc,tz,events!inner({columns},{_ORGANIZATION_EMBED})")
    )
    if start_utc is not None:
        q = q.gte("dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte("dtstart_utc", end_utc.isoformat())
    if school:
        q = q.eq("events.school", school)
    rows = _order_event_date_rows(q).range(0, cap * 5 - 1).execute().data or []

    events = with_click_counts(_dedup_keeping_earliest(rows, cap))
    occ_by_event = event_date_service.list_for_events([row["id"] for row in events])
    return [hydrate_event(row, occ_by_event.get(row["id"], []), model) for row in events]


@supabase_retry
def load_events_page(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school: str | None,
    offset: int,
    limit: int,
    cap: int,
    model: type[T],
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
) -> tuple[list[T], int]:
    """Filtered, paged event list.

    This keeps the event_dates-first ordering that makes date sections correct,
    but only hydrates the page being returned. Filters that PostgREST can apply
    safely are pushed into the joined query; the rest are applied to deduped
    candidates before slicing.
    """
    if ids is not None and not ids:
        return [], 0

    if _can_use_lightweight_date_page(
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
    ):
        return _load_lightweight_date_page(
            start_utc=start_utc,
            end_utc=end_utc,
            school=school,
            offset=offset,
            limit=limit,
            cap=cap,
            model=model,
        )

    columns = _SUMMARY_COLUMNS if model is EventSummaryResponse else "*"
    q = (
        get_sb()
        .table(EVENT_DATES)
        .select(f"event_id,dtstart_utc,dtend_utc,tz,events!inner({columns},{_ORGANIZATION_EMBED})")
    )
    if start_utc is not None:
        q = q.gte("dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte("dtstart_utc", end_utc.isoformat())
    if school:
        q = q.eq("events.school", school)
    if added_within_24h:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        q = q.gte("events.added_at", cutoff)
    if ids is not None:
        q = q.in_("events.id", ids)
    if categories:
        q = q.in_("events.category", categories)
    if organizations:
        q = q.in_("events.organization", organizations)
    if registration is not None:
        q = q.eq("events.registration", registration)
    if min_price is not None:
        q = q.gte("events.price", min_price)
    if max_price is not None:
        q = q.lte("events.price", max_price)

    search_term = sanitize_postgrest_value(search or "")
    if search_term:
        quoted = f'"%{search_term}%"'
        q = q.or_(
            ",".join(
                [
                    f"title.ilike.{quoted}",
                    f"location.ilike.{quoted}",
                    f"organization.ilike.{quoted}",
                ]
            ),
            reference_table="events",
        )

    rows = _order_event_date_rows(q).range(0, cap * 5 - 1).execute().data or []
    candidates = _filter_candidates(
        _dedup_candidates_keeping_earliest(rows, cap),
        search=search_term or None,
        locations=locations,
        foods=foods,
        days=days,
        free_food=free_food,
    )
    candidates = _sort_candidates(candidates, sort_by=sort_by, sort_order=sort_order)
    total = len(candidates)
    page_candidates = candidates[offset : offset + limit]
    page_rows = with_click_counts([candidate.row for candidate in page_candidates])
    occ_by_event = event_date_service.list_for_events([row["id"] for row in page_rows])
    return [hydrate_event(row, occ_by_event.get(row["id"], []), model) for row in page_rows], total


def _can_use_lightweight_date_page(
    *,
    search: str | None,
    categories: list[str] | None,
    locations: list[str] | None,
    foods: list[str] | None,
    days: list[str] | None,
    min_price: float | None,
    max_price: float | None,
    registration: bool | None,
    organizations: list[str] | None,
    free_food: bool,
    ids: list[int] | None,
    sort_by: str,
    sort_order: str,
    added_within_24h: bool,
) -> bool:
    """True for the root-feed shape: date-ordered browsing with no card filters.

    This keeps the common `/events/?page=1&page_size=20&sort_by=date` path from
    embedding full event rows for every candidate just to dedupe and slice.
    Filtered/sorted variants stay on the full candidate path because they need
    event fields while deciding membership and order.
    """

    return (
        not added_within_24h
        and not (search or "").strip()
        and not categories
        and not locations
        and not foods
        and not days
        and min_price is None
        and max_price is None
        and registration is None
        and not organizations
        and not free_food
        and ids is None
        and sort_by == "date"
        and sort_order == "asc"
    )


def _load_lightweight_date_page(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school: str | None,
    offset: int,
    limit: int,
    cap: int,
    model: type[T],
) -> tuple[list[T], int]:
    """Load the default date-ordered page with minimal candidate payload.

    We still compute the exact total so the public paginated response contract
    stays unchanged, but the broad candidate scan carries only occurrence IDs
    and parent event IDs. Full event rows and occurrences are fetched for the
    sliced page only.
    """

    total = _count_lightweight_date_events(start_utc=start_utc, end_utc=end_utc, school=school)
    page_ids = _load_lightweight_date_page_ids(
        start_utc=start_utc,
        end_utc=end_utc,
        school=school,
        offset=offset,
        limit=limit,
        cap=cap,
        total=total,
    )
    if not page_ids:
        return [], total

    columns = _SUMMARY_COLUMNS if model is EventSummaryResponse else "*"
    event_rows = (
        get_sb()
        .table(EVENTS)
        .select(f"{columns},{_ORGANIZATION_EMBED}")
        .in_("id", page_ids)
        .execute()
        .data
        or []
    )
    row_by_id = {row.get("id"): row for row in event_rows}
    page_rows = with_click_counts(
        [row_by_id[event_id] for event_id in page_ids if event_id in row_by_id]
    )
    occ_by_event = event_date_service.list_for_events([row["id"] for row in page_rows])
    return [hydrate_event(row, occ_by_event.get(row["id"], []), model) for row in page_rows], total


def _count_lightweight_date_events(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school: str | None,
) -> int:
    """Exact top-level event count for the default date-ordered feed."""

    embedded_occurrence = f"{EVENT_DATES}!inner(id)"
    q = get_sb().table(EVENTS).select(f"id,{embedded_occurrence}", count="exact")
    if start_utc is not None:
        q = q.gte(f"{EVENT_DATES}.dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte(f"{EVENT_DATES}.dtstart_utc", end_utc.isoformat())
    if school:
        q = q.eq("school", school)
    response = q.limit(0).execute()
    return int(response.count or 0)


def _load_lightweight_date_page_ids(
    *,
    start_utc: datetime | None,
    end_utc: datetime | None,
    school: str | None,
    offset: int,
    limit: int,
    cap: int,
    total: int,
) -> list[int]:
    """Load only enough ordered event IDs to cover the requested page."""

    required_distinct = min(total, offset + limit)
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
            school=school,
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
    school: str | None,
    range_start: int,
    range_end: int,
) -> list[dict]:
    q = get_sb().table(EVENT_DATES).select(_LIGHTWEIGHT_DATE_COLUMNS)
    if start_utc is not None:
        q = q.gte("dtstart_utc", start_utc.isoformat())
    if end_utc is not None:
        q = q.lte("dtstart_utc", end_utc.isoformat())
    if school:
        q = q.eq("events.school", school)
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


def _dedup_candidates_keeping_earliest(rows: list[dict], cap: int) -> list[_EventCandidate]:
    seen: dict[int, _EventCandidate] = {}
    ordered: list[_EventCandidate] = []
    for row in rows:
        event_row = row.get("events")
        if not event_row:
            continue
        rid = event_row.get("id")
        if rid is None:
            continue
        dtstart = _parse_datetime(row.get("dtstart_utc"))
        weekday = _weekday(dtstart, row.get("tz"))
        candidate = seen.get(rid)
        if candidate is not None:
            if weekday:
                candidate.weekdays.add(weekday)
            continue
        candidate = _EventCandidate(row=event_row, earliest_dtstart=dtstart)
        if weekday:
            candidate.weekdays.add(weekday)
        seen[rid] = candidate
        ordered.append(candidate)
        if len(ordered) >= cap:
            break
    return ordered


def _filter_candidates(
    candidates: list[_EventCandidate],
    *,
    search: str | None,
    locations: list[str] | None,
    foods: list[str] | None,
    days: list[str] | None,
    free_food: bool,
) -> list[_EventCandidate]:
    search_value = (search or "").casefold()
    location_terms = [loc.casefold() for loc in locations or [] if loc.strip()]
    food_values = {food for food in foods or [] if food.strip()}
    day_values = {day.casefold() for day in days or [] if day.strip()}

    return [
        candidate
        for candidate in candidates
        if _matches_search(candidate.row, search_value)
        and _matches_locations(candidate.row, location_terms)
        and _matches_foods(candidate.row, food_values)
        and _matches_days(candidate, day_values)
        and _matches_free_food(candidate.row, free_food)
    ]


def _matches_search(row: dict, search: str) -> bool:
    if not search:
        return True
    haystacks = [
        row.get("title") or "",
        row.get("location") or "",
        row.get("organization") or "",
    ]
    return any(search in str(value).casefold() for value in haystacks)


def _matches_locations(row: dict, locations: list[str]) -> bool:
    if not locations:
        return True
    value = str(row.get("location") or "").casefold()
    return any(location in value for location in locations)


def _matches_foods(row: dict, foods: set[str]) -> bool:
    if not foods:
        return True
    event_food = row.get("food") or []
    if isinstance(event_food, str):
        event_food = [event_food]
    return any(item in foods for item in event_food)


def _matches_days(candidate: _EventCandidate, days: set[str]) -> bool:
    if not days:
        return True
    return any(day.casefold() in days for day in candidate.weekdays)


def _matches_free_food(row: dict, free_food: bool) -> bool:
    if not free_food:
        return True
    return bool(row.get("food") or []) and (row.get("price") or 0) == 0


def _sort_candidates(
    candidates: list[_EventCandidate],
    *,
    sort_by: str,
    sort_order: str,
) -> list[_EventCandidate]:
    reverse = sort_order == "desc"

    def key(candidate: _EventCandidate):
        row = candidate.row
        if sort_by == "title":
            return (str(row.get("title") or "").casefold(), row.get("id") or 0)
        if sort_by == "location":
            return (str(row.get("location") or "").casefold(), row.get("id") or 0)
        if sort_by == "price":
            return (row.get("price") or 0, row.get("id") or 0)
        if sort_by == "added_at":
            added_at = _parse_datetime(row.get("added_at"))
            missing_added_at = (
                datetime.min.replace(tzinfo=timezone.utc)
                if reverse
                else datetime.max.replace(tzinfo=timezone.utc)
            )
            return (added_at or missing_added_at, row.get("id") or 0)
        missing_date = (
            datetime.min.replace(tzinfo=timezone.utc)
            if reverse
            else datetime.max.replace(tzinfo=timezone.utc)
        )
        return (candidate.earliest_dtstart or missing_date, row.get("id") or 0)

    return sorted(candidates, key=key, reverse=reverse)


def _parse_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _weekday(value: datetime | None, tz_name: object) -> str | None:
    if value is None:
        return None
    if isinstance(tz_name, str) and tz_name:
        try:
            value = value.astimezone(ZoneInfo(tz_name))
        except ZoneInfoNotFoundError:
            pass
    return value.strftime("%A")
