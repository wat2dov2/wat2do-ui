"""Apply the side effects of rows the ingestion agent changed.

Database triggers record every event and position the agent's login touches
in ``ingestion_changes``. Draining refreshes the affected feeds. People going
to a changed event hear about it through ``event_change_alerts``, like every
other writer's changes.
"""

from __future__ import annotations

import threading
from datetime import datetime

from core.constants.positions import MAX_POSITION_DESCRIPTION_LENGTH
from core.constants.validation import MAX_EVENT_DESCRIPTION_LENGTH
from core.database import get_sb
from core.tables import EVENTS, INGESTION_CHANGES, POSITIONS, SCHOOLS
from services.event_feed_revalidation import event_feed_revalidation_service

_DRAIN_LOCK = threading.Lock()


def drain(*, include_pending_posters: bool = False) -> None:
    """Settle every recorded change, whichever parallel agent made it.

    A row whose poster is still a placeholder belongs to an agent that has not
    stored it yet; settling it now would refresh feeds with a broken image and
    leave that agent nothing to refresh afterwards. It waits for that agent's
    own drain, or for the processor's startup drain if the agent was killed.
    """
    with _DRAIN_LOCK:
        rows = get_sb().table(INGESTION_CHANGES).select("*").execute().data or []
        if rows and not include_pending_posters:
            rows = _without_pending_posters(rows)
        if rows:
            _settle(rows)


def _without_pending_posters(rows: list[dict]) -> list[dict]:
    pending: set[tuple[str, int]] = set()
    for kind, table in (("event", EVENTS), ("position", POSITIONS)):
        ids = [row["record_id"] for row in rows if row["kind"] == kind]
        if ids:
            waiting = (
                get_sb()
                .table(table)
                .select("id")
                .in_("id", ids)
                .like("source_image_url", "pending:%")
                .execute()
                .data
            )
            pending.update((kind, row["id"]) for row in waiting or [])
    return [row for row in rows if (row["kind"], row["record_id"]) not in pending]


def stamp_new_rows(
    source_url: str, *, caption: str, posted_at: datetime | None, since: datetime
) -> None:
    """Give rows the agent created from ``source_url`` the source's text and post time."""
    event = {
        **({"description": caption[:MAX_EVENT_DESCRIPTION_LENGTH]} if caption else {}),
        **({"source_posted_at": posted_at.isoformat()} if posted_at else {}),
    }
    position = {"description": caption[:MAX_POSITION_DESCRIPTION_LENGTH]} if caption else {}
    for table, payload in ((EVENTS, event), (POSITIONS, position)):
        if payload:
            get_sb().table(table).update(payload).eq("source_url", source_url).gte(
                "added_at", since.isoformat()
            ).execute()


def _settle(rows: list[dict]) -> None:
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
