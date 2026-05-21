"""Insert extracted events into the v2 ``events`` + ``event_dates`` tables.

After the v1-style EventDates port (migration 20260428031741), every
logical event is one ``events`` row + N ``event_dates`` rows. The writer
inserts the parent row first, then bulk-inserts occurrences. If the
occurrence insert fails the parent row is rolled back so we don't leave
orphan events with no dates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from core.constants import (
    EVENT_STATUS_ACTIVE,
    MAX_EVENT_CLUB_TYPE_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT,
    MAX_EVENT_FOOD_ITEM_LENGTH,
    MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH,
    MAX_EVENT_ORGANIZATION_LENGTH,
    MAX_EVENT_SCHOOL_LENGTH,
    MAX_EVENT_TITLE_LENGTH,
)
from core.database import get_sb
from core.tables import CLUBS, EVENTS
from schemas.event import normalize_category
from schemas.event_date import OccurrenceCreate
from services import event_date_service
from services.wat2do.dedup import find_match

log = logging.getLogger(__name__)


def write_event(event: dict, *, ig_handle: str, source_url: str) -> str:
    """Insert (or update) the event extracted from one Instagram post.

    Returns one of:
        ``"inserted"``  — new event row + occurrences created.
        ``"updated"``   — same-club update applied to an existing row.
        ``"duplicate"`` — cross-club duplicate, skipped.
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

    club = _resolve_club_by_ig(ig_handle)
    organization = _resolve_organization(event, ig_handle=ig_handle, club=club)
    club_type = club.get("club_type") if club else None
    category = _pick_first_canonical_category(event.get("categories") or [])

    # Build the future-only occurrence list. Past-dated occurrences from
    # mis-parsed captions are dropped here rather than at insert time.
    future_occurrences = _coerce_future_occurrences(occurrences)
    if not future_occurrences:
        log.info(
            "[%s] all %d occurrences for %r are in the past — skipping",
            ig_handle,
            len(occurrences),
            title,
        )
        return "skipped"

    # Same-club / same-day dedup against the events table. Pass the
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
            "[%s] cross-club duplicate of event id=%s — skipping",
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
        "food": _coerce_food(event.get("food")),
        "registration": bool(event.get("registration", False)),
        "source_image_url": (event.get("source_image_url") or None),
        "source_url": source_url or None,
        "club_id": club.get("id") if club else None,
        "club_type": (club_type[:MAX_EVENT_CLUB_TYPE_LENGTH] if club_type else None),
        "school": (event.get("school") or "")[:MAX_EVENT_SCHOOL_LENGTH] or None,
        "category": category,
        "organization": organization[:MAX_EVENT_ORGANIZATION_LENGTH],
        "ig_handle": ig_handle[:MAX_EVENT_HANDLE_LENGTH] if ig_handle else None,
        "status": EVENT_STATUS_ACTIVE,
    }

    if match is not None and match.kind == "same_club":
        existing_id = match.event.get("id")
        log.info(
            "[%s] same-club update on event id=%s for %r",
            ig_handle,
            existing_id,
            title,
        )
        get_sb().table(EVENTS).update(event_row).eq("id", existing_id).execute()
        event_date_service.replace_occurrences(existing_id, future_occurrences)
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
    return "inserted"


def _resolve_club_by_ig(ig_handle: str | None) -> dict | None:
    """Return the registered club row for an Instagram handle, if any."""
    if not ig_handle:
        return None
    rows = (
        get_sb()
        .table(CLUBS)
        .select("id,club_name,club_type")
        .eq("ig", ig_handle)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def _resolve_organization(event: dict, *, ig_handle: str, club: dict | None) -> str:
    """Pick a non-empty organization string for the events row.

    Order: registered club name → extractor's ``organization`` → raw IG
    handle. ``events.organization`` remains NOT NULL for response
    compatibility, but ``club_id`` is the canonical ownership link when
    the handle maps to a known club.
    """
    if club:
        club_name = (club.get("club_name") or "").strip()
        if club_name:
            return club_name

    org = (event.get("organization") or "").strip()
    if org:
        return org

    return ig_handle


def _pick_first_canonical_category(categories: list) -> str | None:
    """v2's events.category is a single string; v1's was a list.

    Walk the extractor's category list, keep the first one that matches
    a canonical category in ``EVENT_CATEGORIES`` (after normalisation).
    Drop any non-string or non-canonical entries silently — the warning
    log already lives in ``schemas.event.normalize_category``.
    """
    for cat in categories:
        if not isinstance(cat, str):
            continue
        normalized = normalize_category(cat)
        if normalized is not None:
            return normalized
    return None


def _coerce_food(value: object) -> list | None:
    """v1 stored food as a single comma-separated string; v2 stores a JSON list.

    Accept both shapes:
        - empty / None / "" → None
        - list[str]         → [stripped, deduped, capped]
        - str               → split on commas, trim, dedupe, cap

    Per-item length and item-count caps both come from
    ``core.constants`` so the writer agrees with the schema.
    """
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        items = [str(v).strip() for v in value if str(v).strip()]
    else:
        items = [tok.strip() for tok in str(value).split(",") if tok.strip()]

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


def _coerce_future_occurrences(occurrences: list[dict]) -> list[OccurrenceCreate]:
    """Filter to future occurrences and return validated OccurrenceCreate models.

    Past occurrences are dropped (mirrors v1: scraped events with a
    dtstart_utc earlier than ``now()`` are noise from misparsed captions).
    Invalid dates are silently skipped — the warning lives at the
    extractor layer where the JSON parsing error is more actionable.
    """
    now = datetime.now(timezone.utc)
    out: list[OccurrenceCreate] = []
    for occ in occurrences:
        if not isinstance(occ, dict):
            continue
        dtstart = _parse_iso(occ.get("dtstart_utc"))
        if dtstart is None or dtstart < now:
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
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
