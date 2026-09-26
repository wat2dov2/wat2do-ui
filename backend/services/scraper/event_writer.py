"""Insert or overwrite extracted events into ``events`` + ``event_dates``.

Pass 2 reconcile owns insert vs overwrite: objects with an existing
integer ``id`` overwrite that row; objects without ``id`` insert.
Every logical event is one ``events`` row + N ``event_dates`` rows.
"""

from __future__ import annotations

import functools
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from core.constants import (
    MAX_CLUB_NAME_LENGTH,
    MAX_EVENT_CLUB_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
)
from core.database import get_sb
from core.sanitize import parse_iso_datetime, remove_surrogates
from core.tables import CLUBS, EVENTS
from schemas.event import normalize_category
from schemas.event_date import OccurrenceCreate, OccurrenceResponse, OccurrenceUpdate
from services import event_date_service, event_service, school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.notifications.event_change import enqueue_event_change

if TYPE_CHECKING:
    from services.scraper.org_resolve import ResolvedClub

log = logging.getLogger(__name__)


def write_event(
    event: dict,
    *,
    ig_handle: str | None,
    source_url: str,
    allow_past_events: bool = False,
    resolved_org: ResolvedClub | None = None,
) -> str:
    """Insert or overwrite one event from Pass 1 / Pass 2 output.

    Returns one of:
        ``"inserted"``  - new event row + occurrences created.
        ``"updated"``   - existing ``id`` overwritten.
        ``"skipped"``   - required field missing or all occurrences past.
    """
    occurrences = event.get("occurrences") or []
    if not occurrences:
        log.warning("[%s] dropping event %r - no occurrences", ig_handle, event.get("title"))
        return "skipped"

    location = (event.get("location") or "").strip()
    title = (event.get("title") or "").strip()
    if not location or not title:
        log.warning(
            "[%s] dropping event - missing required field(s): title=%r location=%r",
            ig_handle,
            title,
            location,
        )
        return "skipped"

    if resolved_org is None:
        from services.scraper.org_resolve import resolve_club_for_scrape

        resolved_org = resolve_club_for_scrape(
            ig_handle=ig_handle,
            school=(event.get("school") or "").strip() or None,
            club_name=(event.get("club") or "").strip() or None,
            create_stub_if_missing=bool((ig_handle or "").strip()),
        )

    effective_ig = resolved_org.ig_handle or (
        ig_handle[:MAX_EVENT_HANDLE_LENGTH] if ig_handle else None
    )
    club_name = _resolve_club_name(
        event,
        ig_handle=effective_ig,
        club_name=resolved_org.club_name,
    )
    category = normalize_category(event.get("category")) if event.get("category") else None
    school_slug = (event.get("school") or "").strip()
    school = school_service.get_school(school_slug)
    if school is None:
        log.warning("[%s] dropping event %r - school is not registered", ig_handle, title)
        return "skipped"

    future_occurrences = _coerce_future_occurrences(
        occurrences, allow_past_events=allow_past_events
    )
    if not future_occurrences:
        log.info(
            "[%s] all %d occurrences for %r are in the past - skipping",
            ig_handle,
            len(occurrences),
            title,
        )
        return "skipped"

    # Truncations mirror the API's ``EventCreate`` schema caps so a row written
    # by the scraper round-trips through the Pydantic boundary.
    event_row = {
        "title": title[:MAX_EVENT_TITLE_LENGTH],
        "description": (event.get("description") or "")[:MAX_EVENT_DESCRIPTION_LENGTH] or None,
        "location": location[:MAX_EVENT_LOCATION_LENGTH],
        "price": event.get("price"),
        "food": _clean_food(event.get("food")),
        "registration": bool(event.get("registration", False)),
        "source_image_url": (event.get("source_image_url") or None),
        "source_url": source_url or None,
        "club_id": resolved_org.club_id,
        "school_id": school.id,
        "category": category,
        "club": club_name[:MAX_EVENT_CLUB_LENGTH],
        "ig_handle": effective_ig[:MAX_EVENT_HANDLE_LENGTH] if effective_ig else None,
        "cancelled": bool(event.get("cancelled", False)),
        "ingestion_source": "instagram_scraper",
    }
    event_row = {k: remove_surrogates(v) for k, v in event_row.items()}

    existing_id = event.get("id")
    if isinstance(existing_id, int):
        return _overwrite_event(
            existing_id,
            event_row,
            future_occurrences,
            ig_handle=ig_handle,
            school_slug=school.slug,
            title=title,
            replace_occurrences=bool(event.get("replace_occurrences", False)),
        )

    inserted = get_sb().table(EVENTS).insert(event_row).execute()
    if not inserted.data:
        log.error("[%s] events insert returned no row for %r", ig_handle, title)
        return "skipped"
    new_id = inserted.data[0]["id"]
    try:
        event_date_service.create_occurrences(new_id, future_occurrences)
    except Exception:
        get_sb().table(EVENTS).delete().eq("id", new_id).execute()
        raise

    log.info(
        "[%s] inserted event id=%s with %d occurrence(s) for %r",
        ig_handle,
        new_id,
        len(future_occurrences),
        title,
    )
    event_feed_revalidation_service.revalidate_school(
        school.slug,
        resources=("events", "clubs"),
    )

    # Cache invalidation for scraper deduplication queries
    from services.scraper.dedup import clear_candidate_caches

    clear_candidate_caches()

    return "inserted"


def _overwrite_event(
    existing_id: int,
    event_row: dict,
    future_occurrences: list[OccurrenceCreate],
    *,
    ig_handle: str | None,
    school_slug: str,
    title: str,
    replace_occurrences: bool,
) -> str:
    """Overwrite an existing event and notify savers on material changes."""
    old_event = event_service.get_event(existing_id)
    if old_event is None:
        log.warning(
            "[%s] Pass 2 id=%s not found for %r - inserting instead",
            ig_handle,
            existing_id,
            title,
        )
        inserted = get_sb().table(EVENTS).insert(event_row).execute()
        if not inserted.data:
            return "skipped"
        new_id = inserted.data[0]["id"]
        try:
            event_date_service.create_occurrences(new_id, future_occurrences)
        except Exception:
            get_sb().table(EVENTS).delete().eq("id", new_id).execute()
            raise
        event_feed_revalidation_service.revalidate_school(
            school_slug,
            resources=("events", "clubs"),
        )

        from services.scraper.dedup import clear_candidate_caches

        clear_candidate_caches()

        return "inserted"

    incoming_org_id = event_row.get("club_id")
    old_org_id = old_event.club_id
    if (
        isinstance(incoming_org_id, int)
        and isinstance(old_org_id, int)
        and incoming_org_id != old_org_id
    ):
        log.warning(
            "[%s] refusing cross-org overwrite id=%s (old_org=%s new_org=%s) for %r - inserting",
            ig_handle,
            existing_id,
            old_org_id,
            incoming_org_id,
            title,
        )
        insert_row = dict(event_row)
        inserted = get_sb().table(EVENTS).insert(insert_row).execute()
        if not inserted.data:
            return "skipped"
        new_id = inserted.data[0]["id"]
        try:
            event_date_service.create_occurrences(new_id, future_occurrences)
        except Exception:
            get_sb().table(EVENTS).delete().eq("id", new_id).execute()
            raise
        event_feed_revalidation_service.revalidate_school(
            school_slug,
            resources=("events", "clubs"),
        )

        from services.scraper.dedup import clear_candidate_caches

        clear_candidate_caches()

        return "inserted"

    merged = _merge_overwrite_payload(event_row, old_event)

    log.info(
        "[%s] overwriting event id=%s for %r",
        ig_handle,
        existing_id,
        title,
    )
    stable_occurrences = (
        _preserve_exact_occurrence_ids(
            old_event.occurrences,
            future_occurrences,
        )
        if replace_occurrences
        else _merge_overwrite_occurrences(
            old_event.occurrences,
            future_occurrences,
        )
    )
    recipient_ids = event_service.update_event_and_occurrences(
        existing_id,
        merged,
        stable_occurrences,
    )
    event_feed_revalidation_service.revalidate_schools(
        [old_event.school, school_slug],
        resources=("events", "clubs"),
    )

    updated = event_service.get_event(existing_id)
    if updated is not None:
        diff = event_service.compute_event_diff(old_event, updated)
        if diff:
            try:
                enqueue_event_change(updated, diff, recipient_ids)
            except Exception as e:
                log.warning(
                    "enqueue_event_change failed for scraped overwrite id=%s: %s",
                    existing_id,
                    e,
                )

    from services.scraper.dedup import clear_candidate_caches

    clear_candidate_caches()

    return "updated"


def _preserve_exact_occurrence_ids(
    existing: list[OccurrenceResponse],
    incoming: list[OccurrenceCreate],
) -> list[OccurrenceUpdate]:
    """Retain IDs only for exact occurrence signatures.

    Positional matching can transfer a user's selection to a different showing.
    Unmatched inputs intentionally receive new IDs in the transaction.
    """
    ids_by_signature: dict[tuple, list] = {}
    for existing_occurrence in existing:
        signature = _occurrence_signature(existing_occurrence)
        ids_by_signature.setdefault(signature, []).append(existing_occurrence.id)

    updates: list[OccurrenceUpdate] = []
    for incoming_occurrence in incoming:
        matching_ids = ids_by_signature.get(
            _occurrence_signature(incoming_occurrence),
            [],
        )
        occurrence_id = matching_ids.pop(0) if matching_ids else None
        updates.append(
            OccurrenceUpdate(
                id=occurrence_id,
                **incoming_occurrence.model_dump(),
            )
        )
    return updates


def _merge_overwrite_occurrences(
    existing: list[OccurrenceResponse],
    incoming: list[OccurrenceCreate],
) -> list[OccurrenceUpdate]:
    """Patch overlapping occurrences and retain dates omitted by a newer post."""
    merged = [
        OccurrenceUpdate(
            id=occurrence.id,
            dtstart_utc=occurrence.dtstart_utc,
            dtend_utc=occurrence.dtend_utc,
            duration=occurrence.duration,
            tz=occurrence.tz,
        )
        for occurrence in existing
    ]
    matched_existing_indexes: set[int] = set()

    for incoming_occurrence in incoming:
        matching_index = None
        for index, existing_occurrence in enumerate(merged):
            if index in matched_existing_indexes or existing_occurrence.id is None:
                continue
            if incoming_occurrence.dtstart_utc != existing_occurrence.dtstart_utc:
                continue
            matching_index = index
            break

        if matching_index is None:
            merged.append(
                OccurrenceUpdate(
                    **incoming_occurrence.model_dump(),
                )
            )
            continue

        old_occurrence = merged[matching_index]
        merged[matching_index] = OccurrenceUpdate(
            id=old_occurrence.id,
            dtstart_utc=incoming_occurrence.dtstart_utc,
            dtend_utc=(
                incoming_occurrence.dtend_utc
                if incoming_occurrence.dtend_utc is not None
                else old_occurrence.dtend_utc
            ),
            duration=(
                incoming_occurrence.duration
                if incoming_occurrence.duration is not None
                else old_occurrence.duration
            ),
            tz=incoming_occurrence.tz or old_occurrence.tz,
        )
        matched_existing_indexes.add(matching_index)

    merged.sort(key=lambda occurrence: occurrence.dtstart_utc)
    return merged


def _occurrence_signature(occurrence) -> tuple:
    return (
        occurrence.dtstart_utc,
        occurrence.dtend_utc,
        occurrence.duration,
        occurrence.tz,
    )


def _merge_overwrite_payload(incoming: dict, old_event) -> dict:
    """Apply newer supplied evidence without erasing older absent fields."""
    merged = dict(incoming)

    for field in (
        "description",
        "price",
        "food",
        "category",
        "ig_handle",
        "club_id",
        "source_url",
        "source_image_url",
    ):
        if merged.get(field) in (None, "", []):
            old_value = getattr(old_event, field, None)
            if old_value not in (None, "", []):
                merged[field] = old_value

    if not merged.get("registration") and old_event.registration:
        merged["registration"] = True
    if not merged.get("cancelled") and old_event.cancelled:
        merged["cancelled"] = True

    return merged


@functools.lru_cache(maxsize=2048)
def _lookup_club_by_ig(ig_handle: str) -> dict | None:
    rows = (
        get_sb()
        .table(CLUBS)
        .select("id,club_name,schools(slug)")
        .eq("ig", ig_handle)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def _ensure_club_by_ig(
    ig_handle: str | None,
    *,
    school: str | None,
    preferred_name: str | None = None,
) -> dict | None:
    """Return the club for an IG handle, creating a stub row when missing."""
    cleaned = (ig_handle or "").strip().lstrip("@")
    if not cleaned:
        return None

    existing = _lookup_club_by_ig(cleaned)
    if existing is not None:
        return existing

    school_slug = (school or "").strip()
    if not school_slug:
        log.warning("[%s] skipping club auto-create - school slug is required", cleaned)
        return None
    school_record = school_service.get_school(school_slug)
    if school_record is None:
        log.warning("[%s] skipping club auto-create - school is not registered", cleaned)
        return None

    club_name = ((preferred_name or "").strip() or f"@{cleaned}")[:MAX_CLUB_NAME_LENGTH]
    inserted = (
        get_sb()
        .table(CLUBS)
        .insert(
            {
                "club_name": club_name,
                "ig": cleaned,
                "school_id": school_record.id,
            }
        )
        .execute()
    )
    if inserted.data:
        row = inserted.data[0]
        log.info(
            "[%s] auto-created club id=%s name=%r school=%s",
            cleaned,
            row.get("id"),
            club_name,
            school_slug,
        )
        _lookup_club_by_ig.cache_clear()

        from services import club_service

        club_service._get_clubs_for_school_lookup.cache_clear()
        event_feed_revalidation_service.revalidate_school(school_slug, resources=("clubs",))

        return row

    return _lookup_club_by_ig(cleaned)


def _resolve_club_name(
    event: dict,
    *,
    ig_handle: str | None,
    club_name: str | None = None,
) -> str:
    """Pick a non-empty club string for the events row.

    Order: resolved club name → extractor's ``club`` → raw IG
    handle. ``club_id`` is the canonical ownership link when known.
    """
    if club_name and club_name.strip():
        return club_name.strip()

    org = (event.get("club") or "").strip()
    if org:
        return org

    if ig_handle:
        return f"@{ig_handle.lstrip('@')}"
    return "Unknown Club"


def _clean_food(value: object) -> list | None:
    """Validate and normalize the current JSON-list food shape."""
    if value in (None, []):
        return None
    if isinstance(value, list):
        items = [str(v).strip() for v in value if str(v).strip()]
    else:
        raise ValueError("food must be a list of strings")

    seen: set[str] = set()
    deduped: list[str] = []
    for item in items:
        normalized_item = "Food" if item.casefold() in {"yes", "yes!"} else item
        clean_item = remove_surrogates(normalized_item[:MAX_EVENT_FOOD_ITEM_LENGTH])
        if not clean_item:
            continue
        key = clean_item.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(clean_item)
        if len(deduped) >= MAX_EVENT_FOOD_COUNT:
            break
    return deduped or None


def _coerce_future_occurrences(
    occurrences: list[dict], allow_past_events: bool = False
) -> list[OccurrenceCreate]:
    """Filter to future occurrences and return validated OccurrenceCreate models."""
    now = datetime.now(timezone.utc)
    out: list[OccurrenceCreate] = []
    for occ in occurrences:
        if not isinstance(occ, dict):
            continue
        dtstart = parse_iso_datetime(occ.get("dtstart_utc"))
        if dtstart is None:
            continue
        if not allow_past_events and dtstart < now:
            continue
        dtend = parse_iso_datetime(occ.get("dtend_utc"))
        try:
            out.append(
                OccurrenceCreate(
                    dtstart_utc=dtstart,
                    dtend_utc=dtend,
                    duration=(occ.get("duration") or None),
                    tz=(occ.get("tz") or None),
                )
            )
        except Exception as e:
            log.warning("Skipping invalid occurrence %r: %s", occ, e)
    return out
