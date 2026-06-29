"""Insert extracted events into the ``events`` + ``event_dates`` tables.

Every logical event is one ``events`` row + N ``event_dates`` rows. The
writer inserts the parent row first, then bulk-inserts occurrences. If the
occurrence insert fails the parent row is rolled back so we don't leave
orphan events with no dates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from core.constants import (
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_ORGANIZATION_LENGTH,
    MAX_EVENT_ORGANIZATION_TYPE_LENGTH,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
    MAX_ORGANIZATION_NAME_LENGTH,
)
from core.database import get_sb
from core.tables import EVENTS, ORGANIZATIONS
from schemas.event import normalize_category
from schemas.event_date import OccurrenceCreate
from services import event_date_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.scraper.dedup import find_match

log = logging.getLogger(__name__)

_SCRAPED_ORGANIZATION_TYPE = "Independent"


def write_event(
    event: dict, *, ig_handle: str | None, source_url: str, allow_past_events: bool = False
) -> str:
    """Insert (or update) the event extracted from one Instagram post.

    Returns one of:
        ``"inserted"``  — new event row + occurrences created.
        ``"updated"``   — same-organization update applied to an existing row.
        ``"duplicate"`` — cross-organization duplicate, skipped.
        ``"skipped"``   — required field missing (e.g. no occurrence,
                          no location); caller should log.
    """
    occurrences = event.get("occurrences") or []
    if not occurrences:
        log.warning("[%s] dropping event %r — no occurrences", ig_handle, event.get("title"))
        return "skipped"

    location = (event.get("location") or "").strip()
    title = (event.get("title") or "").strip()
    if not location or not title:
        log.warning(
            "[%s] dropping event — missing required field(s): title=%r location=%r",
            ig_handle,
            title,
            location,
        )
        return "skipped"

    organization_dict = _ensure_organization_by_ig(
        ig_handle,
        school=(event.get("school") or "").strip() or None,
        preferred_name=(event.get("organization") or "").strip() or None,
    )
    organization_name = _resolve_organization_name(
        event, ig_handle=ig_handle, organization=organization_dict
    )
    organization_type = organization_dict.get("organization_type") if organization_dict else None
    category = normalize_category(event.get("category")) if event.get("category") else None

    # Build the future-only occurrence list. Past-dated occurrences from
    # mis-parsed captions are dropped here rather than at insert time.
    future_occurrences = _coerce_future_occurrences(
        occurrences, allow_past_events=allow_past_events
    )
    if not future_occurrences:
        log.info(
            "[%s] all %d occurrences for %r are in the past — skipping",
            ig_handle,
            len(occurrences),
            title,
        )
        return "skipped"

    # Same-organization / same-day dedup against the events table. Pass the
    # filtered future-only list so the same-day window is computed
    # against an actual upcoming date — passing the unfiltered list
    # could put ``occurrences[0]`` at a past dtstart and drive the
    # day-window check against a stale day with no relevant matches.
    future_occurrence_dicts = [o.model_dump(mode="json") for o in future_occurrences]
    match = find_match(
        title=title,
        location=location,
        description=event.get("description") or "",
        occurrences=future_occurrence_dicts,
        ig_handle=ig_handle,
    )
    if match is not None and match.kind == "duplicate":
        log.info(
            "[%s] cross-organization duplicate of event id=%s — skipping",
            ig_handle,
            match.event.get("id"),
        )
        return "duplicate"

    # Truncations mirror the API's ``EventCreate`` schema caps (defined in
    # core/constants.py) so a row written by the scraper round-trips through
    # the Pydantic boundary. The DB columns themselves are wider in places
    # (events.title is varchar(500), schema cap is 300) — slicing to the
    # tighter cap keeps the user-facing contract consistent.
    event_row = {
        "title": title[:MAX_EVENT_TITLE_LENGTH],
        "description": (event.get("description") or "")[:MAX_EVENT_DESCRIPTION_LENGTH] or None,
        "location": location[:MAX_EVENT_LOCATION_LENGTH],
        "price": event.get("price"),
        "food": _clean_food(event.get("food")),
        "registration": bool(event.get("registration", False)),
        "source_image_url": (event.get("source_image_url") or None),
        "source_url": source_url or None,
        "organization_id": organization_dict.get("id") if organization_dict else None,
        "organization_type": (
            organization_type[:MAX_EVENT_ORGANIZATION_TYPE_LENGTH] if organization_type else None
        ),
        "school": (event.get("school") or "")[:MAX_EVENT_SCHOOL_LENGTH] or None,
        "category": category,
        "organization": organization_name[:MAX_EVENT_ORGANIZATION_LENGTH],
        "ig_handle": ig_handle[:MAX_EVENT_HANDLE_LENGTH] if ig_handle else None,
    }

    if match is not None and match.kind == "same_organization":
        existing_id = match.event.get("id")
        log.info(
            "[%s] same-organization update on event id=%s for %r",
            ig_handle,
            existing_id,
            title,
        )
        get_sb().table(EVENTS).update(event_row).eq("id", existing_id).execute()
        event_date_service.replace_occurrences(existing_id, future_occurrences)
        event_feed_revalidation_service.revalidate_school(event_row.get("school"))
        return "updated"

    inserted = get_sb().table(EVENTS).insert(event_row).execute()
    if not inserted.data:
        log.error("[%s] events insert returned no row for %r", ig_handle, title)
        return "skipped"
    new_id = inserted.data[0]["id"]
    try:
        event_date_service.create_occurrences(new_id, future_occurrences)
    except Exception:
        # Clean up the orphan event row — without occurrences it would
        # be invisible to the listing query (LEFT JOIN row with NULL
        # date columns) but still pollute the table.
        get_sb().table(EVENTS).delete().eq("id", new_id).execute()
        raise

    log.info(
        "[%s] inserted event id=%s with %d occurrence(s) for %r",
        ig_handle,
        new_id,
        len(future_occurrences),
        title,
    )
    event_feed_revalidation_service.revalidate_school(event_row.get("school"))
    return "inserted"


def _lookup_organization_by_ig(ig_handle: str) -> dict | None:
    rows = (
        get_sb()
        .table(ORGANIZATIONS)
        .select("id,organization_name,organization_type")
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
        log.warning("[%s] skipping organization auto-create — school slug is required", cleaned)
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
                "school": school_slug,
                "organization_type": _SCRAPED_ORGANIZATION_TYPE,
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
    event: dict, *, ig_handle: str | None, organization: dict | None
) -> str:
    """Pick a non-empty organization string for the events row.

    Order: registered organization name → extractor's ``organization`` → raw IG
    handle. ``organization_id`` is the canonical ownership link when the handle maps
    to a known organization.
    """
    if organization:
        organization_name = (organization.get("organization_name") or "").strip()
        if organization_name:
            return organization_name

    org = (event.get("organization") or "").strip()
    if org:
        return org

    # If it falls back to the IG handle, format it as a handle (e.g. @username)
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
    """Filter to future occurrences and return validated OccurrenceCreate models.

    Past occurrences are dropped because scraped events with a ``dtstart_utc``
    earlier than ``now()`` are usually noise from misparsed captions. Invalid
    dates are skipped; the extractor layer logs the JSON parsing error.
    """
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
            # OccurrenceCreate's validators reject dtend <= dtstart and a
            # few other shapes; one bad occurrence shouldn't drop the
            # whole event.
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
