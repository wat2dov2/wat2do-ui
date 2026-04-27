"""Insert extracted events into the v2 ``events`` table.

v1's events schema had a separate ``EventDates`` table for multi-occurrence
events. v2 collapsed that — every Event row carries its own ``dtstart_utc``
/ ``dtend_utc`` pair. The translation: each occurrence the extractor
returns becomes an independent Event row sharing the rest of the metadata
(image, source_url, ig_handle, etc.).

The writer is the only module in the pipeline that touches the events
table directly; everything else builds dicts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from core.constants import EVENT_STATUS_ACTIVE
from core.database import get_sb
from core.tables import CLUBS, EVENTS
from schemas.event import normalize_category
from services.wat2do.dedup import MatchResult, find_match

log = logging.getLogger(__name__)


def write_event(event: dict, *, ig_handle: str, source_url: str) -> str:
    """Insert (or update) the event(s) extracted from one Instagram post.

    Returns one of:
        ``"inserted"``  — new row(s) created.
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
            ig_handle, title, location,
        )
        return "skipped"

    organization = _resolve_organization(event, ig_handle=ig_handle)
    club_type = _resolve_club_type(ig_handle)
    category = _pick_first_canonical_category(event.get("categories") or [])

    # Same-club / same-day dedup against the events table.
    match = find_match(
        title=title,
        location=location,
        description=event.get("description") or "",
        occurrences=occurrences,
        ig_handle=ig_handle,
    )
    if match is not None and match.kind == "duplicate":
        log.info(
            "[%s] cross-club duplicate of event id=%s — skipping",
            ig_handle, match.event.get("id"),
        )
        return "duplicate"

    rows = []
    for occ in occurrences:
        dtstart = _parse_iso(occ.get("dtstart_utc"))
        if dtstart is None:
            continue
        # Past-event filter (matches v1): drop occurrences whose start is
        # already in the past — they are noise from misparsed captions.
        if dtstart < datetime.now(timezone.utc):
            continue

        rows.append({
            "title": title[:500],
            "description": (event.get("description") or "")[:5000] or None,
            "location": location[:500],
            "dtstart_utc": dtstart.isoformat(),
            "dtend_utc": _maybe_iso(occ.get("dtend_utc")),
            "price": event.get("price"),
            "food": _coerce_food(event.get("food")),
            "registration": bool(event.get("registration", False)),
            "source_image_url": (event.get("source_image_url") or None),
            "source_url": source_url or None,
            "club_type": (club_type[:100] if club_type else None),
            "school": (event.get("school") or "")[:255] or None,
            "category": category,
            "organization": organization[:255],
            "ig_handle": ig_handle[:255] if ig_handle else None,
            "status": EVENT_STATUS_ACTIVE,
        })

    if not rows:
        log.info(
            "[%s] all %d occurrences for %r are in the past — skipping",
            ig_handle, len(occurrences), title,
        )
        return "skipped"

    if match is not None and match.kind == "same_club":
        # v1 keeps a single row and updates it with the latest data from the
        # newest post.  v2 has one row per occurrence — so we update the
        # matched row with the FIRST occurrence's data and let the rest fall
        # through as new inserts (preserves all known dates of a recurring
        # series even when an existing row matched the title).
        first, rest = rows[0], rows[1:]
        existing_id = match.event.get("id")
        log.info(
            "[%s] same-club update on event id=%s for %r",
            ig_handle, existing_id, title,
        )
        get_sb().table(EVENTS).update(first).eq("id", existing_id).execute()
        if rest:
            get_sb().table(EVENTS).insert(rest).execute()
        return "updated"

    get_sb().table(EVENTS).insert(rows).execute()
    log.info("[%s] inserted %d row(s) for %r", ig_handle, len(rows), title)
    return "inserted"


def _resolve_organization(event: dict, *, ig_handle: str) -> str:
    """Pick a non-empty organization string for the events row.

    Order: extractor's ``organization`` -> club lookup by IG handle ->
    raw IG handle. ``events.organization`` is NOT NULL in the v2 schema,
    so we always return a non-empty string.
    """
    org = (event.get("organization") or "").strip()
    if org:
        return org

    if ig_handle:
        rows = (
            get_sb()
            .table(CLUBS)
            .select("club_name")
            .eq("ig", ig_handle)
            .limit(1)
            .execute()
        ).data or []
        if rows:
            club_name = (rows[0].get("club_name") or "").strip()
            if club_name:
                return club_name

    return ig_handle or "Unknown"


def _resolve_club_type(ig_handle: str | None) -> str | None:
    """Return the registered ``club_type`` for the IG handle, or None."""
    if not ig_handle:
        return None
    rows = (
        get_sb()
        .table(CLUBS)
        .select("club_type")
        .eq("ig", ig_handle)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        return None
    return rows[0].get("club_type")


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
    """v1 stored food as a single comma-separated string. v2 stores it as a JSON list.

    Accept both shapes:
        - empty / None / "" -> None
        - list[str]         -> [stripped, deduped, capped]
        - str               -> split on commas, trim, dedupe, cap

    Capped at 20 items (matches MAX_EVENT_FOOD_COUNT in core/constants.py)
    so a runaway extraction doesn't blow the schema validator at insert time.
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
        deduped.append(item[:100])
        if len(deduped) >= 20:
            break
    return deduped or None


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


def _maybe_iso(value: str | None) -> str | None:
    parsed = _parse_iso(value)
    return parsed.isoformat() if parsed else None
