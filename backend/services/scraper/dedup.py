"""Duplicate-event detection for the scraping pipeline.

Thresholds live in the SCRAPING_* constants in ``core/constants.py``.

The detector exposes one public method, ``find_match``, returning either
None or an existing-event row. Callers (event_writer) decide whether to
treat the match as a same-organization update vs. a cross-organization duplicate.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from urllib.parse import urlparse

from core.constants import (
    SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD,
    SCRAPING_LOCATION_SIMILARITY_THRESHOLD,
    SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD,
    SCRAPING_TITLE_SIMILARITY_THRESHOLD,
)
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENT_DATES, EVENTS

log = logging.getLogger(__name__)


def normalize(s: str) -> str:
    """Lowercase + strip non-alphanumeric — used for substring duplicate checks."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def jaccard_similarity(a: str, b: str) -> float:
    """Word-set Jaccard similarity. Empty strings -> 0.0."""
    set_a = set(re.findall(r"\w+", (a or "").lower()))
    set_b = set(re.findall(r"\w+", (b or "").lower()))
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def sequence_similarity(a: str, b: str) -> float:
    """SequenceMatcher ratio (case-insensitive)."""
    return SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def title_similarity(a: str, b: str) -> float:
    """Combined title similarity — max of Jaccard and SequenceMatcher.

    Taking the max catches both word-overlap titles ("Movie Night Friday" vs
    "Friday Movie Night") and reordered-but-similar titles.
    """
    return max(jaccard_similarity(a, b), sequence_similarity(a, b))


class MatchResult:
    """Result of a dedup lookup.

    ``kind`` is one of:
      * ``same_organization`` — caller should UPDATE the existing event
        (location/dates/etc) and refresh ``added_at``.
      * ``duplicate`` — caller should SKIP the insert (some other organization
        already has this event on the same day, or location-based match).
    """

    __slots__ = ("kind", "event")

    def __init__(self, kind: str, event: dict):
        self.kind = kind
        self.event = event


def find_match(
    *,
    title: str,
    location: str,
    description: str,
    occurrences: list[dict],
    ig_handle: str | None,
) -> MatchResult | None:
    """Return a match for the given event, or None.

    Two-stage check:
        1. Same-organization update — any event from the same ``ig_handle`` whose
           latest occurrence is in the future and whose title is >0.8
           similar.
        2. Same-day duplicate — any event whose ``dtstart_utc`` falls on
           the same UTC day as the candidate's first occurrence and
           passes the location/description/title threshold gauntlet.

    ``occurrences`` is the extractor's output shape. Empty / missing
    first-occurrence start time means no match (we cannot compare).
    """
    if not occurrences:
        return None
    target_start = _parse_iso8601_utc(occurrences[0].get("dtstart_utc"))
    if target_start is None:
        return None

    same_organization = _check_same_organization_update(
        ig_handle=ig_handle,
        candidate_title=title,
    )
    if same_organization is not None:
        return MatchResult("same_organization", same_organization)

    same_day = _check_same_day_duplicate(
        target_start=target_start,
        candidate_title=title,
        candidate_location=location,
        candidate_description=description,
    )
    if same_day is not None:
        return MatchResult("duplicate", same_day)

    return None


def _parse_iso8601_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Python's ``fromisoformat`` accepts the trailing ``Z`` from 3.11+
        # but we still normalise for older interpreters / extractor quirks.
        cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _check_same_organization_update(
    *,
    ig_handle: str | None,
    candidate_title: str,
) -> dict | None:
    """Return an existing event from the same organization whose title is too similar.

    The events row no longer carries dtstart_utc / dtend_utc — dates live
    in the event_dates table. We embed the event_dates rows for each
    candidate and check the latest end time to decide whether the event
    is still in flight (any future occurrence keeps it alive).

    Paginated via ``fetch_all_pages`` — long-lived organizations can accumulate
    >1000 events and PostgREST silently caps the result at 1000. Without
    pagination, dedup against older same-organization events would be invisible
    (and the row order without ``.order()`` is undefined).
    """
    if not ig_handle:
        return None

    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select("id,title,ig_handle,location,description,event_dates(dtstart_utc,dtend_utc)")
            .eq("ig_handle", ig_handle)
            .order("id", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    rows = fetch_all_pages(_page)

    now = datetime.now(timezone.utc)
    for row in rows:
        occurrences = row.get("event_dates") or []
        if not occurrences:
            continue
        latest_end = _latest_occurrence_end(occurrences)
        # Skip past events — a same-named event in the past is a new
        # occurrence of a recurring series, not an update.
        if latest_end is None or latest_end < now:
            continue

        if (
            title_similarity(row.get("title") or "", candidate_title)
            > SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD
        ):
            log.info(
                "Same-organization update candidate: %r matches existing event id=%s (%r)",
                candidate_title,
                row.get("id"),
                row.get("title"),
            )
            return row
    return None


def _check_same_day_duplicate(
    *,
    target_start: datetime,
    candidate_title: str,
    candidate_location: str,
    candidate_description: str,
) -> dict | None:
    """Return an existing event on the same UTC day that fails the duplicate gauntlet.

    Queries event_dates first (one row per occurrence), then embeds the
    parent event metadata. Multiple occurrences of the same event on the
    same day collapse to one event-row check via the ``seen`` set.

    Paginated via ``fetch_all_pages`` — peak days can have >1000
    occurrences across all schools and PostgREST silently truncates at
    1000 rows.
    """
    day_start = target_start.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENT_DATES)
            .select("event_id,events(id,title,ig_handle,location,description)")
            .gte("dtstart_utc", day_start.isoformat())
            .lt("dtstart_utc", day_end.isoformat())
            .order("id", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    rows = fetch_all_pages(_page)

    norm_candidate_title = normalize(candidate_title)
    seen_event_ids: set[int] = set()

    for date_row in rows:
        event = date_row.get("events")
        if not event:
            continue
        eid = event.get("id")
        if eid in seen_event_ids:
            continue
        seen_event_ids.add(eid)

        existing_title = event.get("title") or ""
        existing_location = event.get("location") or ""
        existing_description = event.get("description") or ""

        loc_sim = jaccard_similarity(existing_location, candidate_location)
        substring_match = normalize(
            existing_title
        ) in norm_candidate_title or norm_candidate_title in normalize(existing_title)

        if substring_match:
            if loc_sim > SCRAPING_LOCATION_SIMILARITY_THRESHOLD:
                return event
            continue

        title_sim = title_similarity(existing_title, candidate_title)
        desc_sim = jaccard_similarity(existing_description, candidate_description)

        title_and_loc = (
            title_sim > SCRAPING_TITLE_SIMILARITY_THRESHOLD
            and loc_sim > SCRAPING_LOCATION_SIMILARITY_THRESHOLD
        )
        loc_and_desc = (
            loc_sim > SCRAPING_LOCATION_SIMILARITY_THRESHOLD
            and desc_sim > SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD
        )

        if title_and_loc or loc_and_desc:
            return event

    return None


def _latest_occurrence_end(occurrences: list[dict]) -> datetime | None:
    """Return the latest dtend (or dtstart fallback) across occurrences."""
    candidates: list[datetime] = []
    for occ in occurrences:
        end = _parse_iso8601_utc(occ.get("dtend_utc")) or _parse_iso8601_utc(occ.get("dtstart_utc"))
        if end is not None:
            candidates.append(end)
    return max(candidates) if candidates else None


def existing_shortcodes() -> set[str]:
    """Return the set of shortcodes already present in the events table.

    Used by the pipeline's filter stage to skip posts we have already
    processed. The shortcode is the post-id segment of an Instagram
    post URL — e.g. for ``https://www.instagram.com/p/AbCDeF1/?utm=...``
    it is ``AbCDeF1``.

    Paginated via ``fetch_all_pages`` because PostgREST silently caps
    the response at 1000 rows by default — without pagination, an
    events table with >1000 rows would only dedupe against the first
    1000 returned (and the order without ``.order()`` is undefined),
    causing previously-scraped posts to be re-inserted as duplicates.
    """

    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select("source_url")
            .not_.is_("source_url", "null")
            .order("id", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    rows = fetch_all_pages(_page)
    seen: set[str] = set()
    for row in rows:
        url = row.get("source_url")
        if not url:
            continue
        shortcode = _extract_shortcode(url)
        if shortcode:
            seen.add(shortcode)
    return seen


# Instagram post / reel URL pattern — captures the shortcode (alphanumeric
# + dashes / underscores). Used by both ``_extract_shortcode`` and the
# pipeline's per-post filter so a URL with a query string or trailing
# fragment doesn't disagree on what the canonical shortcode is.
_SHORTCODE_RE = re.compile(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)")


def _extract_shortcode(source_url: str) -> str | None:
    """Pull the post shortcode out of an Instagram URL.

    Handles trailing slashes, query strings, fragments, and reel/tv
    paths. Returns ``None`` when no shortcode can be extracted (e.g. the
    URL is from a different domain or the URL is a profile link).

    Examples:
        https://www.instagram.com/p/AbCDeF1/                 -> "AbCDeF1"
        https://www.instagram.com/p/AbCDeF1/?utm_source=x    -> "AbCDeF1"
        https://instagram.com/reel/XYZ7/                     -> "XYZ7"
        https://instagram.com/uwteaorganization                      -> None
    """
    if not source_url:
        return None
    try:
        path = urlparse(source_url).path
    except ValueError:
        return None
    match = _SHORTCODE_RE.search(path)
    return match.group(1) if match else None
