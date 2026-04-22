"""Events via Supabase. Sync so no asyncpg/SQLAlchemy."""

import logging
from datetime import datetime, timezone

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.errors import EVENT_ALREADY_PAST
from core.exceptions import ValidationError
from core.sanitize import sanitize_postgrest_value
from core.tables import EVENTS
from services.recommendation_service import invalidate_candidates_cache
from schemas.event import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventSummaryResponse,
    LatestEventResponse,
    EVENT_SUMMARY_COLUMNS,
)

log = logging.getLogger(__name__)


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


def get_event(event_id: int) -> EventResponse | None:
    r = get_sb().table(EVENTS).select("*").eq("id", event_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return EventResponse.model_validate(r.data[0])


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
) -> list[EventSummaryResponse] | list[EventResponse]:
    select_cols = EVENT_SUMMARY_COLUMNS if summary else "*"
    q = get_sb().table(EVENTS).select(select_cols)
    if category:
        q = q.eq("category", category)
    if club_type:
        q = q.eq("club_type", club_type)
    if school:
        q = q.eq("school", school)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            # Sanitize strips PostgREST control chars (commas, dots, parens,
            # quotes) then we double-quote so the value is a safe literal.
            quoted = f'"%{term}%"'
            columns = ("title", "description", "location", "organization")
            q = q.or_(",".join(f"{col}.ilike.{quoted}" for col in columns))
    if from_date:
        q = q.gte("dtstart_utc", from_date.isoformat())
    if to_date:
        q = q.lte("dtstart_utc", to_date.isoformat())
    if has_food is True:
        q = q.not_.is_("food", "null").neq("food", "[]")
    if max_price is not None:
        # Format as fixed-point to avoid scientific notation (e.g. 1e-05)
        # and ensure the value contains only digits/dot — no PostgREST
        # control characters can appear in the filter string.
        safe_price = f"{max_price:.6f}"
        q = q.or_(f"price.is.null,price.lte.{safe_price}")
    if registration is not None:
        q = q.eq("registration", registration)
    q = q.order("dtstart_utc", desc=True).range(skip, skip + limit - 1)
    r = q.execute()
    model = EventSummaryResponse if summary else EventResponse
    return [model.model_validate(e) for e in (r.data or [])]


def create_event(data: EventCreate, *, created_by: str) -> EventResponse:
    payload = data.model_dump(mode="json")
    payload["created_by"] = created_by
    r = get_sb().table(EVENTS).insert(payload).execute()
    invalidate_candidates_cache()
    return EventResponse.model_validate(r.data[0])


def has_ended(event: EventResponse, *, now: datetime | None = None) -> bool:
    """Return True if the event is strictly in the past.

    Uses ``dtend_utc`` if present (true completion time), else falls back
    to ``dtstart_utc`` as the event's boundary.  Events with neither
    timestamp are treated as always-mutable (legacy rows).

    Shared with the credits router (audit I6 — reject promotion of
    already-past events).  Kept public so both writers agree on the
    definition of "past".
    """
    reference = event.dtend_utc or event.dtstart_utc
    if reference is None:
        return False
    current = now or datetime.now(timezone.utc)
    # ``reference`` was parsed by Pydantic as datetime; it may be naive for
    # legacy rows.  Coerce to UTC-aware for a safe comparison.
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    return reference < current


def update_event(event_id: int, data: EventUpdate) -> EventResponse | None:
    """Update an event, refusing edits to already-past events.

    Past-event freezing (audit I12) — once the event has ended (dtend_utc
    < now, or dtstart_utc < now when no end is set), all mutations are
    rejected.  This prevents owners from silently rewriting title /
    dtstart / organization on an event that users have already saved or
    interacted with.
    """
    existing = get_event(event_id)
    if existing is None:
        return None
    if has_ended(existing):
        log.warning(
            "Rejected update to past event id=%s (dtstart=%s dtend=%s)",
            event_id,
            existing.dtstart_utc,
            existing.dtend_utc,
        )
        raise ValidationError(EVENT_ALREADY_PAST)

    payload = data.model_dump(mode="json", exclude_unset=True)
    if not payload:
        return existing

    # Flag large dtstart rewrites explicitly in logs — they are legal for
    # future events but usually indicate a misuse pattern (recycling an
    # event ID for a totally different occasion); see audit I12 note.
    new_dtstart = payload.get("dtstart_utc")
    if (
        new_dtstart is not None
        and existing.dtstart_utc is not None
        and new_dtstart != existing.dtstart_utc.isoformat()
    ):
        log.warning(
            "dtstart_utc changed on event id=%s from %s to %s",
            event_id,
            existing.dtstart_utc,
            new_dtstart,
        )

    r = get_sb().table(EVENTS).update(payload).eq("id", event_id).execute()
    invalidate_candidates_cache()
    return EventResponse.model_validate(r.data[0]) if r.data else None


def delete_event(event_id: int) -> bool:
    # C6: event_promotions.event_id has ON DELETE CASCADE, so any active
    # paid promotion on this event would silently disappear when the row
    # is deleted.  Prorate-refund the unused portion first (via the ledger
    # so the audit trail stays correct) before dropping the event.  The
    # refund helper logs per-row failures and never raises, so a single
    # bad promotion row cannot block the deletion.
    from services import credit_service  # local import to avoid cycle
    try:
        credit_service.refund_active_promotions_for_event(event_id)
    except Exception as e:
        # Defensive: the helper already logs and catches, but if a fresh
        # bug slips past, log and continue — blocking the deletion on a
        # refund glitch would be worse than the partial refund.
        log.error(
            "refund_active_promotions_for_event failed for event=%s: %s",
            event_id, e,
        )

    r = get_sb().table(EVENTS).delete().eq("id", event_id).execute()
    if r.data:
        invalidate_candidates_cache()
    return bool(r.data)
