"""Occurrence-aware Going selections persisted through one atomic RPC."""

import logging
from collections import defaultdict
from itertools import batched
from uuid import UUID

from postgrest.exceptions import APIError

from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    EVENT_NOT_FOUND,
    GOING_EVENTS_CAP_REACHED,
    INVALID_EVENT_OCCURRENCE,
    OCCURRENCE_NOT_SELECTABLE,
)
from core.exceptions import NotFoundError, ValidationError
from core.pagination import fetch_all_pages
from core.tables import USER_GOING_EVENTS, USERS
from schemas.going_event import (
    EventAttendeeResponse,
    GoingEventSelection,
    GoingEventStatusResponse,
    UserEventPair,
)
from services.user_service import avatar_url_for_user

log = logging.getLogger(__name__)

_RPC_ERRORS = {
    "event_not_found": (NotFoundError, EVENT_NOT_FOUND),
    "invalid_event_occurrence": (ValidationError, INVALID_EVENT_OCCURRENCE),
    "event_cancelled": (ValidationError, OCCURRENCE_NOT_SELECTABLE),
    "occurrence_not_selectable": (ValidationError, OCCURRENCE_NOT_SELECTABLE),
    "going_events_cap_reached": (ValidationError, GOING_EVENTS_CAP_REACHED),
}


def get_going_event_selections(user_id: str) -> list[GoingEventSelection]:
    """Return one grouped selection per event for a user."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("event_id,event_date_id")
                .eq("user_id", user_id)
                .order("going_at", desc=True)
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        ),
    )
    grouped: dict[int, list[UUID]] = defaultdict(list)
    for row in rows:
        grouped[int(row["event_id"])].append(UUID(str(row["event_date_id"])))
    return [
        GoingEventSelection(event_id=event_id, occurrence_ids=occurrence_ids)
        for event_id, occurrence_ids in grouped.items()
    ]


def set_going_occurrences(
    user_id: str,
    event_id: int,
    occurrence_ids: list[UUID],
) -> GoingEventStatusResponse:
    """Atomically replace a user's complete occurrence selection for an event."""
    try:
        response = (
            get_sb()
            .rpc(
                "set_user_going_occurrences",
                {
                    "p_user_id": user_id,
                    "p_event_id": event_id,
                    "p_occurrence_ids": [str(occurrence_id) for occurrence_id in occurrence_ids],
                },
            )
            .execute()
        )
    except APIError as exc:
        mapped = _RPC_ERRORS.get(exc.message)
        if mapped is not None:
            exception_type, detail = mapped
            raise exception_type(detail) from exc
        raise

    if not response.data:
        raise RuntimeError("Going mutation returned no result")
    return GoingEventStatusResponse.model_validate(response.data[0])


# Cap the public who's-going list; the count still reflects everyone.
MAX_ATTENDEE_NAMES = controlbox.public_attendance.maximum_display_names


def _abbreviate_full_name(full_name: str | None) -> str | None:
    """Reduce "First Middle Last" to "First L." for public display."""
    if not full_name:
        return None
    parts = full_name.split()
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def get_event_attendees(event_id: int) -> list[EventAttendeeResponse]:
    """Return distinct profiles, including unnamed users, ordered by first Going time."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("user_id")
                .eq("event_id", event_id)
                .order("going_at")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        ),
    )
    user_ids = list(dict.fromkeys(str(row["user_id"]) for row in rows))[:MAX_ATTENDEE_NAMES]
    if not user_ids:
        return []

    user_rows = (
        get_sb().table(USERS).select("id,full_name,avatar_url").in_("id", user_ids).execute()
    ).data or []
    users = {str(row["id"]): row for row in user_rows}
    attendees = []
    for user_id in user_ids:
        row = users.get(user_id, {})
        attendees.append(
            EventAttendeeResponse(
                name=_abbreviate_full_name(row.get("full_name")) or "",
                avatar_url=avatar_url_for_user(user_id, row.get("avatar_url")),
            )
        )
    return attendees


def get_going_counts_for_events(event_ids: list[int]) -> dict[int, int]:
    """Return distinct-user Going counts keyed by event ID."""
    unique_ids = list(dict.fromkeys(event_ids))
    if not unique_ids:
        return {}

    counts: dict[int, int] = {}
    for chunk in batched(unique_ids, 500):
        rows = (
            get_sb().rpc("get_event_going_counts", {"p_event_ids": list(chunk)}).execute().data
            or []
        )
        counts.update({int(row["event_id"]): int(row["going_count"]) for row in rows})
    return counts


def get_all_user_goings() -> list[UserEventPair]:
    """Return distinct (user_id, event_id) inputs for recommendation batches."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("user_id,event_id")
                .order("going_at")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        ),
    )
    pairs = {(UUID(str(row["user_id"])), int(row["event_id"])) for row in rows}
    return [
        UserEventPair(user_id=user_id, event_id=event_id)
        for user_id, event_id in sorted(pairs, key=lambda pair: (str(pair[0]), pair[1]))
    ]
