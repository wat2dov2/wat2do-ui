"""Candidate-event detection for the scraping pipeline.

Thresholds live in the SCRAPING_* constants in ``core/constants.py``.

``find_candidates`` returns zero-or-more existing event rows that look
similar enough to feed Pass 2 reconcile. Pass 2 owns insert/overwrite;
this module only gathers candidates.
"""

from __future__ import annotations

import functools
import logging
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from urllib.parse import urlparse

from core.constants import (
    SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD,
    SCRAPING_LOCATION_SIMILARITY_THRESHOLD,
    SCRAPING_MAX_CANDIDATES,
    SCRAPING_MAX_CROSS_ORG_CANDIDATES,
    SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD,
    SCRAPING_TITLE_SIMILARITY_THRESHOLD,
)
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENT_DATES, EVENTS
from services import school_service
from services.organization_service import _normalize_organization_name

log = logging.getLogger(__name__)

_CANDIDATE_EVENT_SELECT = (
    "id,title,description,location,price,food,registration,category,"
    "organization,organization_id,ig_handle,school_id,cancelled,source_url,source_image_url,"
    f"{school_service.SCHOOL_SLUG_EMBED},"
    "event_dates(dtstart_utc,dtend_utc,duration,tz)"
)

_SAME_DAY_EVENT_EMBED = (
    "id,title,description,location,price,food,registration,category,"
    "organization,organization_id,ig_handle,school_id,cancelled,source_url,source_image_url,"
    f"{school_service.SCHOOL_SLUG_EMBED},"
    "event_dates(dtstart_utc,dtend_utc,duration,tz)"
)


def normalize(s: str) -> str:
    """Lowercase + strip non-alphanumeric - used for substring duplicate checks."""
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
    """Combined title similarity - max of Jaccard and SequenceMatcher.

    Taking the max catches both word-overlap titles ("Movie Night Friday" vs
    "Friday Movie Night") and reordered-but-similar titles.
    """
    return max(jaccard_similarity(a, b), sequence_similarity(a, b))


def find_candidates(
    *,
    title: str,
    location: str,
    description: str,
    occurrences: list[dict],
    ig_handle: str | None,
    organization_id: int | None = None,
    organization_name: str | None = None,
    limit: int = SCRAPING_MAX_CANDIDATES,
    max_cross_org: int = SCRAPING_MAX_CROSS_ORG_CANDIDATES,
) -> list[dict]:
    """Return similar existing events for Pass 2 reconcile.

    Combines:
      1. Same-organization future events with similar titles
         (``organization_id`` first, else ``ig_handle``).
      2. Same-day events that pass the location/description/title gauntlet,
         plus soft normalized-name matches when org id is unresolved.

    Same-org candidates are ranked first; cross-org same-day rows are capped
    tighter. Empty / missing first-occurrence start time means only
    same-organization candidates can be returned.
    """
    same_org_ids: set[int] = set()
    scored: dict[int, tuple[float, dict, bool]] = {}

    for row in _same_organization_candidates(
        organization_id=organization_id,
        ig_handle=ig_handle,
        candidate_title=title,
    ):
        eid = row.get("id")
        if not isinstance(eid, int):
            continue
        score = title_similarity(row.get("title") or "", title)
        same_org_ids.add(eid)
        scored[eid] = (score, _normalize_candidate(row), True)

    target_start = None
    if occurrences:
        target_start = _parse_iso8601_utc(occurrences[0].get("dtstart_utc"))
    if target_start is not None:
        for row in _same_day_candidates(
            target_start=target_start,
            candidate_title=title,
            candidate_location=location,
            candidate_description=description,
            organization_id=organization_id,
            organization_name=organization_name,
        ):
            eid = row.get("id")
            if not isinstance(eid, int):
                continue
            score = title_similarity(row.get("title") or "", title)
            is_same_org = eid in same_org_ids or _is_same_org_row(
                row,
                organization_id=organization_id,
                ig_handle=ig_handle,
            )
            existing = scored.get(eid)
            if existing is None or score > existing[0]:
                scored[eid] = (score, _normalize_candidate(row), is_same_org)
            elif is_same_org and not existing[2]:
                scored[eid] = (existing[0], existing[1], True)

    same_org = [(s, r) for s, r, same in scored.values() if same]
    cross_org = [(s, r) for s, r, same in scored.values() if not same]
    same_org.sort(key=lambda item: item[0], reverse=True)
    cross_org.sort(key=lambda item: item[0], reverse=True)

    out: list[dict] = [r for _, r in same_org[: max(limit, 0)]]
    remaining = max(limit - len(out), 0)
    cross_cap = min(max(max_cross_org, 0), remaining)
    out.extend(r for _, r in cross_org[:cross_cap])
    return out


def _is_same_org_row(
    row: dict,
    *,
    organization_id: int | None,
    ig_handle: str | None,
) -> bool:
    if isinstance(organization_id, int) and row.get("organization_id") == organization_id:
        return True
    cleaned = (ig_handle or "").strip().lstrip("@")
    if cleaned and (row.get("ig_handle") or "").strip().lstrip("@") == cleaned:
        return True
    return False


def _normalize_candidate(row: dict) -> dict:
    """Flatten embedded event_dates into ``occurrences`` for the Pass 2 prompt."""
    out = dict(row)
    dates = out.pop("event_dates", None) or []
    occurrences: list[dict] = []
    for occ in dates:
        if not isinstance(occ, dict):
            continue
        occurrences.append(
            {
                "dtstart_utc": occ.get("dtstart_utc"),
                "dtend_utc": occ.get("dtend_utc"),
                "duration": occ.get("duration"),
                "tz": occ.get("tz"),
            }
        )
    out["occurrences"] = occurrences
    out.setdefault("cancelled", False)
    out.setdefault("organization_id", None)
    return out


def _parse_iso8601_utc(value: str | None) -> datetime | None:
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


def clear_candidate_caches() -> None:
    """Clear in-memory deduplication caches after a successful write."""
    _fetch_org_events_by_id.cache_clear()
    _fetch_org_events_by_ig.cache_clear()
    _fetch_day_events.cache_clear()


@functools.lru_cache(maxsize=128)
def _fetch_org_events_by_id(organization_id: int) -> list[dict]:
    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select(_CANDIDATE_EVENT_SELECT)
            .eq("organization_id", organization_id)
            .order("id", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    return fetch_all_pages(_page)


@functools.lru_cache(maxsize=128)
def _fetch_org_events_by_ig(ig_handle: str) -> list[dict]:
    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select(_CANDIDATE_EVENT_SELECT)
            .eq("ig_handle", ig_handle)
            .order("id", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    return fetch_all_pages(_page)


def _same_organization_candidates(
    *,
    organization_id: int | None,
    ig_handle: str | None,
    candidate_title: str,
) -> list[dict]:
    """Return future same-org events whose title clears the similarity threshold."""

    if isinstance(organization_id, int):
        rows = _fetch_org_events_by_id(organization_id)
    elif ig_handle:
        rows = _fetch_org_events_by_ig(ig_handle)
    else:
        return []

    now = datetime.now(timezone.utc)
    out: list[dict] = []
    for row in rows:
        row = school_service.with_school_slug(row)
        occurrences = row.get("event_dates") or []
        if not occurrences:
            continue
        latest_end = _latest_occurrence_end(occurrences)
        if latest_end is None or latest_end < now:
            continue
        if (
            title_similarity(row.get("title") or "", candidate_title)
            > SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD
        ):
            out.append(row)
    return out


@functools.lru_cache(maxsize=128)
def _fetch_day_events(day_start_iso: str, day_end_iso: str) -> list[dict]:
    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENT_DATES)
            .select(f"event_id,events({_SAME_DAY_EVENT_EMBED})")
            .gte("dtstart_utc", day_start_iso)
            .lt("dtstart_utc", day_end_iso)
            .order("id", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    return fetch_all_pages(_page)


def _same_day_candidates(
    *,
    target_start: datetime,
    candidate_title: str,
    candidate_location: str,
    candidate_description: str,
    organization_id: int | None,
    organization_name: str | None,
) -> list[dict]:
    """Return same-UTC-day events that pass the duplicate similarity gauntlet."""
    day_start = target_start.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    soft_name = _normalize_organization_name(organization_name)
    allow_soft_name = soft_name and not isinstance(organization_id, int)

    rows = _fetch_day_events(day_start.isoformat(), day_end.isoformat())
    norm_candidate_title = normalize(candidate_title)
    seen_event_ids: set[int] = set()
    out: list[dict] = []

    for date_row in rows:
        event = date_row.get("events")
        if not event:
            continue
        event = school_service.with_school_slug(event)
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
                out.append(event)
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
            out.append(event)
            continue

        # Soft name signal for candidate gathering only when org_id unresolved.
        if allow_soft_name and title_sim > SCRAPING_TITLE_SIMILARITY_THRESHOLD:
            existing_name = _normalize_organization_name(event.get("organization"))
            if existing_name and existing_name == soft_name:
                out.append(event)

    return out


def _latest_occurrence_end(occurrences: list[dict]) -> datetime | None:
    """Return the latest dtend (or dtstart fallback) across occurrences."""
    candidates: list[datetime] = []
    for occ in occurrences:
        end = _parse_iso8601_utc(occ.get("dtend_utc")) or _parse_iso8601_utc(occ.get("dtstart_utc"))
        if end is not None:
            candidates.append(end)
    return max(candidates) if candidates else None


def existing_shortcodes(shortcodes: set[str]) -> set[str]:
    """Return which of the provided shortcodes already exist on ``events.source_url``.

    Used by the pipeline filter stage. Queries only for the provided shortcodes
    to prevent memory and latency issues as the events table grows.
    """
    if not shortcodes:
        return set()

    clean_shortcodes = {sc.strip().strip("/") for sc in shortcodes if sc.strip()}
    if not clean_shortcodes:
        return set()

    conditions = ",".join(f"source_url.ilike.%/{sc}%" for sc in clean_shortcodes)

    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select("source_url")
            .not_.is_("source_url", "null")
            .or_(conditions)
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
        if shortcode and shortcode in clean_shortcodes:
            seen.add(shortcode)
    return seen


def existing_urls(urls: set[str]) -> set[str]:
    """Return which of the provided exact URLs already exist on ``events.source_url``.

    Used by the directory scraper pipeline filter stage to prevent N+1 queries.
    """
    if not urls:
        return set()

    clean_urls = {u.strip() for u in urls if u.strip()}
    if not clean_urls:
        return set()

    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select("source_url")
            .in_("source_url", list(clean_urls))
            .order("id", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        ).data or []

    rows = fetch_all_pages(_page)
    seen: set[str] = set()
    for row in rows:
        url = row.get("source_url")
        if url and url in clean_urls:
            seen.add(url)
    return seen


# Captures the shortcode from /p/, /reel/, or /tv/ paths (query/fragment-safe).
_SHORTCODE_RE = re.compile(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)")


def _extract_shortcode(source_url: str) -> str | None:
    """Pull the Instagram post shortcode from a URL, or ``None`` if absent."""
    if not source_url:
        return None
    try:
        path = urlparse(source_url).path
    except ValueError:
        return None
    match = _SHORTCODE_RE.search(path)
    return match.group(1) if match else None
