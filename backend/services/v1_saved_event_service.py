"""V1 saved events persisted separately from V2 Going selections."""

import logging
import uuid
from datetime import datetime, timezone

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import V1_SAVED_EVENTS
from schemas.v1_saved_event import V1SavedEventResponse

log = logging.getLogger(__name__)


def get_saved_event_ids(user_id: str) -> list[int]:
    """Return V1 event IDs saved by this user."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(V1_SAVED_EVENTS)
                .select("event_id")
                .eq("user_id", user_id)
                .order("saved_at", desc=True)
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        ),
    )
    return [int(row["event_id"]) for row in rows]


def _get_saved_event(user_id: str, event_id: int) -> V1SavedEventResponse | None:
    response = (
        get_sb()
        .table(V1_SAVED_EVENTS)
        .select("*")
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return V1SavedEventResponse.model_validate(response.data[0])


def save_event(user_id: str, event_id: int) -> V1SavedEventResponse:
    """Save a V1 event idempotently."""
    existing = _get_saved_event(user_id, event_id)
    if existing is not None:
        return existing

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
    }
    response = get_sb().table(V1_SAVED_EVENTS).insert(payload).execute()
    if response.data:
        return V1SavedEventResponse.model_validate(response.data[0])

    log.warning(
        "Insert returned no data for save_event(user_id=%s, event_id=%s), using payload fallback",
        user_id,
        event_id,
    )
    return V1SavedEventResponse(**payload, saved_at=datetime.now(timezone.utc))


def unsave_event(user_id: str, event_id: int) -> bool:
    """Remove a V1 saved event. Return whether a row was deleted."""
    response = (
        get_sb()
        .table(V1_SAVED_EVENTS)
        .delete()
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .execute()
    )
    return bool(response.data)
