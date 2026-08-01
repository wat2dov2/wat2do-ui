"""Insert or overwrite extracted events into ``events`` + ``event_dates``.

Pass 2 reconcile owns insert vs overwrite: objects with an existing
integer ``id`` overwrite that row; objects without ``id`` insert.
Every logical event is one ``events`` row + N ``event_dates`` rows.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from core.constants import (
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_ORGANIZATION_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
    MAX_ORGANIZATION_NAME_LENGTH,
)
from core.database import get_sb
from core.tables import EVENTS, ORGANIZATIONS
from schemas.event import normalize_category
from schemas.event_date import OccurrenceCreate, OccurrenceResponse, OccurrenceUpdate
from services import event_date_service, event_service, school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.notifications.event_change import enqueue_event_change

if TYPE_CHECKING:
    from services.scraper.org_resolve import ResolvedOrganization

log = logging.getLogger(__name__)


def write_event(
    event: dict,
    *,
    ig_handle: str | None,
    source_url: str,
    allow_past_events: bool = False,
    resolved_org: ResolvedOrganization | None = None,
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
        from services.scraper.org_resolve import resolve_organization_for_scrape

        resolved_org = resolve_organization_for_scrape(
            ig_handle=ig_handle,
            school=(event.get("school") or "").strip() or None,
            organization_name=(event.get("organization") or "").strip() or None,
            create_stub_if_missing=bool((ig_handle or "").strip()),
        )

    effective_ig = resolved_org.ig_handle or (
        ig_handle[:MAX_EVENT_HANDLE_LENGTH] if ig_handle else None
    )
    organization_name = _resolve_organization_name(
        event,
        ig_handle=effective_ig,
        organization_name=resolved_org.organization_name,
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
        "organization_id": resolved_org.organization_id,
        "school_id": school.id,
        "category": category,
        "organization": organization_name[:MAX_EVENT_ORGANIZATION_LENGTH],
        "ig_handle": effective_ig[:MAX_EVENT_HANDLE_LENGTH] if effective_ig else None,
        "cancelled": bool(event.get("cancelled", False)),
        "ingestion_source": "instagram_scraper",
    }

    existing_id = event.get("id")
    if isinstance(existing_id, int):
        return _overwrite_event(
            existing_id,
            event_row,
            future_occurrences,
            ig_handle=ig_handle,
            school_slug=school.slug,
            title=title,
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
    event_feed_revalidation_service.revalidate_school(school.slug)
    return "inserted"


def _overwrite_event(
    existing_id: int,
    event_row: dict,
    future_occurrences: list[OccurrenceCreate],
    *,
    ig_handle: str | None,
    school_slug: str,
    title: str,
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
        event_feed_revalidation_service.revalidate_school(school_slug)
        return "inserted"

    incoming_org_id = event_row.get("organization_id")
    old_org_id = old_event.organization_id
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
        event_feed_revalidation_service.revalidate_school(school_slug)
        return "inserted"

    merged = _merge_overwrite_payload(event_row, old_event)

    log.info(
        "[%s] overwriting event id=%s for %r",
        ig_handle,
        existing_id,
        title,
    )
    stable_occurrences = _preserve_exact_occurrence_ids(
        old_event.occurrences,
        future_occurrences,
    )
    recipient_ids = event_service.update_event_and_occurrences(
        existing_id,
        merged,
        stable_occurrences,
    )
    event_feed_revalidation_service.revalidate_school(school_slug)

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


def _occurrence_signature(occurrence) -> tuple:
    return (
        occurrence.dtstart_utc,
        occurrence.dtend_utc,
        occurrence.duration,
        occurrence.tz,
    )


def _merge_overwrite_payload(incoming: dict, old_event) -> dict:
    """Field-merge provenance so null/empty incoming cannot wipe ownership."""
    merged = dict(incoming)

    if merged.get("ig_handle") is None and old_event.ig_handle:
        merged["ig_handle"] = old_event.ig_handle
    if merged.get("organization_id") is None and old_event.organization_id is not None:
        merged["organization_id"] = old_event.organization_id
    if not merged.get("source_url") and old_event.source_url:
        merged["source_url"] = old_event.source_url
    if not merged.get("source_image_url") and old_event.source_image_url:
        merged["source_image_url"] = old_event.source_image_url

    return merged


def _lookup_organization_by_ig(ig_handle: str) -> dict | None:
    rows = (
        get_sb()
        .table(ORGANIZATIONS)
        .select("id,organization_name,schools(slug)")
        .eq("ig", ig_handle)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def _ensure_organization_by_ig(
    ig_handle: str | None,
    *,
    school: str | None,
    preferred_name: str | None = None,
) -> dict | None:
    """Return the organization for an IG handle, creating a stub row when missing."""
    cleaned = (ig_handle or "").strip().lstrip("@")
    if not cleaned:
        return None

    existing = _lookup_organization_by_ig(cleaned)
    if existing is not None:
        return existing

    school_slug = (school or "").strip()
    if not school_slug:
        log.warning("[%s] skipping organization auto-create - school slug is required", cleaned)
        return None
    school_record = school_service.get_school(school_slug)
    if school_record is None:
        log.warning("[%s] skipping organization auto-create - school is not registered", cleaned)
        return None

    organization_name = ((preferred_name or "").strip() or f"@{cleaned}")[
        :MAX_ORGANIZATION_NAME_LENGTH
    ]
    inserted = (
        get_sb()
        .table(ORGANIZATIONS)
        .insert(
            {
                "organization_name": organization_name,
                "ig": cleaned,
                "school_id": school_record.id,
            }
        )
        .execute()
    )
    if inserted.data:
        row = inserted.data[0]
        log.info(
            "[%s] auto-created organization id=%s name=%r school=%s",
            cleaned,
            row.get("id"),
            organization_name,
            school_slug,
        )
        return row

    return _lookup_organization_by_ig(cleaned)


def _resolve_organization_name(
    event: dict,
    *,
    ig_handle: str | None,
    organization_name: str | None = None,
) -> str:
    """Pick a non-empty organization string for the events row.

    Order: resolved organization name → extractor's ``organization`` → raw IG
    handle. ``organization_id`` is the canonical ownership link when known.
    """
    if organization_name and organization_name.strip():
        return organization_name.strip()

    org = (event.get("organization") or "").strip()
    if org:
        return org

    if ig_handle:
        return f"@{ig_handle.lstrip('@')}"
    return "Unknown Organization"


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
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item[:MAX_EVENT_FOOD_ITEM_LENGTH])
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
        dtstart = _parse_iso(occ.get("dtstart_utc"))
        if dtstart is None:
            continue
        if not allow_past_events and dtstart < now:
            continue
        dtend = _parse_iso(occ.get("dtend_utc"))
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


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)
