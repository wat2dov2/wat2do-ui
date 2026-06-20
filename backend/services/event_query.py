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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel

from core.database import get_sb
from core.retry import supabase_retry
from core.sanitize import sanitize_postgrest_value
from core.tables import EVENT_DATES
from schemas.event import EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Columns the summary response needs (everything except the occurrences we
# hydrate separately). The full response model just selects everything.
_SUMMARY_COLUMNS = ",".join(f for f in EventSummaryResponse.model_fields if f != "occurrences")


@dataclass
class _EventCandidate:
    row: dict
    earliest_dtstart: datetime | None
    weekdays: set[str] = field(default_factory=set)


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
) -> tuple[list[T], int]:
    """Filtered, paged event list.

    This keeps the event_dates-first ordering that makes date sections correct,
    but only hydrates the page being returned. Filters that PostgREST can apply
    safely are pushed into the joined query; the rest are applied to deduped
    candidates before slicing.
    """
    if ids is not None and not ids:
        return [], 0

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

    rows = q.order("dtstart_utc", desc=False).range(0, cap * 5 - 1).execute().data or []
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
    page_rows = [candidate.row for candidate in page_candidates]
    occ_by_event = event_date_service.list_for_events([row["id"] for row in page_rows])
    return [hydrate_event(row, occ_by_event.get(row["id"], []), model) for row in page_rows], total


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
