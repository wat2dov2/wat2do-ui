"""Events via the data API. Sync so no asyncpg/SQLAlchemy.

Events store metadata (title, location, image, etc.); occurrence dates
live in ``event_dates`` (via ``event_date_service``) and are returned on
response models as the ``occurrences`` list.
"""

from datetime import datetime, timezone

from core.database import get_sb
from core.tables import EVENTS
from schemas.event import EventResponse, EventSummaryResponse
from schemas.event_date import OccurrenceResponse, OccurrenceUpdate
from services import (
    event_date_service,
    event_query,
    school_service,
)

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


def normalize_campus_season_ids(value: object, school: str | None) -> list[str] | None:
    """Keep school-owned IDs, preserving unknown versus reviewed-empty metadata.

    Extraction drops invalid model output without dropping an otherwise valid
    event or claiming that it was reviewed negative. (API edits, in Rust,
    reject invalid IDs instead.)
    """
    if value is None or not isinstance(value, list):
        return None
    allowed = school_service.campus_season_ids(school or "")
    valid = sorted({item for item in value if isinstance(item, str) and item in allowed})
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
