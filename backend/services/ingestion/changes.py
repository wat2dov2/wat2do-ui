"""Apply the side effects of rows the ingestion agent changed.

Database triggers record every event and position the agent's login touches
in ``ingestion_changes``, with the event as it was before. Draining refreshes
the affected feeds and alerts people going to an event whose dates, location, or cancellation changed.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from uuid import UUID

from core.constants.positions import MAX_POSITION_DESCRIPTION_LENGTH
from core.constants.validation import MAX_EVENT_DESCRIPTION_LENGTH
from core.database import get_sb
from core.tables import EVENTS, INGESTION_CHANGES, POSITIONS, SCHOOLS
from services import event_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.notifications.event_change import enqueue_event_change

log = logging.getLogger(__name__)


_DRAIN_LOCK = threading.Lock()


def drain() -> None:
    """Settle every recorded change, whichever parallel agent made it."""
    with _DRAIN_LOCK:
        rows = get_sb().table(INGESTION_CHANGES).select("*").execute().data or []
        if rows:
            _settle(rows)


def describe(source_url: str, caption: str, *, since: datetime) -> None:
    """Give rows the agent created from ``source_url`` the source's original text."""
    for table, limit in (
        (EVENTS, MAX_EVENT_DESCRIPTION_LENGTH),
        (POSITIONS, MAX_POSITION_DESCRIPTION_LENGTH),
    ):
        get_sb().table(table).update({"description": caption[:limit]}).eq(
            "source_url", source_url
        ).gte("added_at", since.isoformat()).execute()


def _settle(rows: list[dict]) -> None:
    for row in rows:
        if row["kind"] == "event" and row["snapshot"] is not None:
            _alert_going(row["record_id"], row["snapshot"])
    school_ids = sorted({row["school_id"] for row in rows if row["school_id"] is not None})
    schools = (
        get_sb().table(SCHOOLS).select("slug").in_("id", school_ids).execute().data
        if school_ids
        else []
    )
    event_feed_revalidation_service.revalidate_schools(
        [school["slug"] for school in schools or []],
        resources=("events", "clubs", "positions"),
    )
    for kind in ("event", "position"):
        ids = [row["record_id"] for row in rows if row["kind"] == kind]
        if ids:
            get_sb().table(INGESTION_CHANGES).delete().eq("kind", kind).in_(
                "record_id", ids
            ).execute()


def _alert_going(event_id: int, snapshot: dict) -> None:
    recipients = [UUID(user_id) for user_id in snapshot.get("going_user_ids") or []]
    current = event_service.get_event(event_id) if recipients else None
    if current is None:
        return
    before = type(current).model_validate(
        {
            **current.model_dump(),
            "location": snapshot["location"],
            "cancelled": snapshot["cancelled"],
            "occurrences": snapshot["occurrences"],
        }
    )
    diff = event_service.compute_event_diff(before, current)
    if not diff:
        return
    try:
        enqueue_event_change(current, diff, recipients)
    except Exception:
        log.warning("Going alert failed for event id=%s", event_id, exc_info=True)
