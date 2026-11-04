"""Events via the data API. Sync so no asyncpg/SQLAlchemy.

Events store metadata (title, location, image, etc.); occurrence dates
live in ``event_dates`` (via ``event_date_service``) and are returned on
response models as the ``occurrences`` list.
"""

import logging
from datetime import datetime, timezone

from postgrest.exceptions import APIError

from core.database import get_sb
from core.errors import CLUB_NOT_FOUND, EVENT_ALREADY_PAST
from core.exceptions import NotFoundError, ValidationError
from core.tables import EVENTS
from schemas.event import (
    EventCreate,
    EventResponse,
    EventSummaryResponse,
    EventUpdate,
)
from schemas.event_date import OccurrenceResponse, OccurrenceUpdate
from services import (
    event_date_service,
    event_query,
    school_service,
)
from services.event_feed_revalidation import event_feed_revalidation_service

log = logging.getLogger(__name__)


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


def _resolve_club_fields(club_id: int) -> dict[str, str | int | None]:
    """Derive the event's denormalized fields from its owning club.

    The club is the single source of truth for an event's display name
    and school - callers never set these directly, so both the
    direct-create path and the submission-approval path stay in agreement.
    """
    from services import club_service  # local import avoids an import cycle

    club = club_service.get_club(club_id)
    if club is None:
        raise NotFoundError(CLUB_NOT_FOUND)
    school_id = club.school_id or school_service.get_school_id(club.school)
    if school_id is None:
        raise ValidationError("Club school is not registered")
    return {
        "club": club.club_name,
        "school_id": school_id,
        "school": club.school,
    }


def normalize_campus_season_ids(
    value: object, school: str | None, *, strict: bool = False
) -> list[str] | None:
    """Validate school-owned IDs, preserving unknown versus reviewed-empty metadata.

    API edits reject invalid IDs. Extraction drops invalid model output without
    dropping an otherwise valid event or claiming that it was reviewed negative.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        if strict:
            raise ValidationError("Campus season IDs must be an array")
        return None
    allowed = school_service.campus_season_ids(school or "")
    valid = sorted({item for item in value if isinstance(item, str) and item in allowed})
    if strict and any(not isinstance(item, str) or item not in allowed for item in value):
        raise ValidationError("Campus season IDs must be configured for the event's school")
    return valid if valid or not value else None


# ── Public functions ──────────────────────────────────────────────────


def get_event(event_id: int) -> EventResponse | None:
    r = (
        get_sb()
        .table(EVENTS)
        .select(
            f"*,{event_query.CLUB_EMBED},{event_query.SCHOOL_EMBED},{event_query.INSTAGRAM_ITEMS_EMBED}"
        )
        .eq("id", event_id)
        .execute()
    )
    if not r.data or len(r.data) == 0:
        return None
    occurrences = event_date_service.list_for_event(event_id)
    return event_query.hydrate_event(r.data[0], occurrences, EventResponse)


def create_event(data: EventCreate, *, created_by: str) -> EventResponse:
    payload = data.model_dump(mode="json")
    payload.pop("occurrences", None)
    club_fields = _resolve_club_fields(data.club_id)
    school = club_fields.pop("school")
    payload.update(club_fields)
    payload["campus_season_ids"] = normalize_campus_season_ids(
        data.campus_season_ids, str(school) if school else None, strict=True
    )
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
    event_feed_revalidation_service.revalidate_school(
        created.school,
        resources=("events", "clubs"),
    )
    return created


def has_ended(event: EventResponse | EventSummaryResponse, *, now: datetime | None = None) -> bool:
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


def update_event(event_id: int, data: EventUpdate) -> EventResponse | None:
    """Update an event, refusing edits to already-past events.

    Past-event freezing (audit I12) - once every occurrence has passed,
    mutations are rejected. This prevents owners from silently rewriting
    title / dtstart / club on an event users already saved.
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

    # Reassigning the club re-derives the denormalized display fields so the
    # event row never drifts from its owning club.
    school = existing.school
    if payload.get("club_id") is not None:
        club_fields = _resolve_club_fields(payload["club_id"])
        resolved_school = club_fields.pop("school")
        school = str(resolved_school) if resolved_school else None
        payload.update(club_fields)
        if school != existing.school:
            payload["cohost_club_ids"] = []
        if school != existing.school and "campus_season_ids" not in payload:
            payload["campus_season_ids"] = None
    if "campus_season_ids" in payload:
        payload["campus_season_ids"] = normalize_campus_season_ids(
            payload["campus_season_ids"], school, strict=True
        )

    update_event_and_occurrences(
        event_id,
        payload,
        data.occurrences if new_occurrences is not None else None,
    )

    updated = get_event(event_id)
    if updated is not None:
        event_feed_revalidation_service.revalidate_schools(
            [existing.school, updated.school],
            resources=("events", "clubs"),
        )
    return updated


def update_event_and_occurrences(
    event_id: int,
    event_patch: dict,
    occurrences: list[OccurrenceUpdate] | None,
) -> None:
    """Apply an event patch and stable occurrence set through the transaction RPC."""
    (
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


def delete_event(event_id: int) -> bool:
    existing = get_event(event_id)
    r = get_sb().table(EVENTS).delete().eq("id", event_id).execute()
    if r.data:
        event_feed_revalidation_service.revalidate_school(
            existing.school if existing is not None else None,
            resources=("events", "clubs"),
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

    Omits occurrence identity because only material date changes belong in the diff.
    The remaining fields (dtstart_utc, dtend_utc, duration, tz) are what
    users actually care about being notified on.
    """
    return {
        "dtstart_utc": occ.dtstart_utc.isoformat(),
        "dtend_utc": occ.dtend_utc.isoformat() if occ.dtend_utc else None,
        "duration": occ.duration,
        "tz": occ.tz,
    }
