"""Event RSVPs: persist user "I'm Going" commitments to Supabase."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_EVENT_RSVPS
from schemas.event_rsvp import EventRsvpResponse

log = logging.getLogger(__name__)


def get_rsvp_event_ids(user_id: str) -> list[int]:
    """Return event IDs the user has RSVP'd 'going' to."""
    rows = fetch_all_pages(
        lambda offset, ps: (
            get_sb()
            .table(USER_EVENT_RSVPS)
            .select("event_id")
            .eq("user_id", user_id)
            .order("rsvped_at", desc=True)
            .range(offset, offset + ps - 1)
            .execute()
        ).data or [],
    )
    return [row["event_id"] for row in rows]


def count_rsvps(user_id: str) -> int:
    """Return the total number of events this user has RSVP'd to."""
    r = (
        get_sb()
        .table(USER_EVENT_RSVPS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def _get_rsvp_row(user_id: str, event_id: int) -> EventRsvpResponse | None:
    """Return the existing ``user_event_rsvps`` row for (user_id, event_id)."""
    r = (
        get_sb()
        .table(USER_EVENT_RSVPS)
        .select("*")
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    if r.data:
        return EventRsvpResponse.model_validate(r.data[0])
    return None


def rsvp_event(user_id: str, event_id: int) -> EventRsvpResponse:
    """RSVP to an event, idempotently.

    If a row already exists for (user_id, event_id), return it unchanged.
    Otherwise insert a new row with a fresh UUID. The
    ``unique(user_id, event_id)`` constraint is the ultimate guarantee.
    """
    existing = _get_rsvp_row(user_id, event_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    r = (
        get_sb()
        .table(USER_EVENT_RSVPS)
        .insert(payload)
        .execute()
    )
    if r.data:
        return EventRsvpResponse.model_validate(r.data[0])
    log.warning(
        "Insert returned no data for rsvp_event(user_id=%s, event_id=%s), using payload fallback",
        user_id,
        event_id,
    )
    return EventRsvpResponse(**payload, rsvped_at=datetime.now(timezone.utc))


def unrsvp_event(user_id: str, event_id: int) -> bool:
    """Remove an RSVP. Returns True if a row was deleted."""
    r = (
        get_sb()
        .table(USER_EVENT_RSVPS)
        .delete()
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .execute()
    )
    return bool(r.data)
