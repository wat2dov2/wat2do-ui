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
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from urllib.parse import urlparse

from core.constants import (
    SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD,
    SCRAPING_LOCATION_SIMILARITY_THRESHOLD,
    SCRAPING_MAX_CANDIDATES,
    SCRAPING_MAX_CROSS_ORG_CANDIDATES,
    SCRAPING_SAME_CLUB_TITLE_THRESHOLD,
    SCRAPING_TITLE_SIMILARITY_THRESHOLD,
)
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.sanitize import parse_iso_datetime
from core.tables import EVENT_DATES, EVENTS
from services import school_service
from services.club_service import _normalize_club_name

log = logging.getLogger(__name__)

_LANGUAGE_QUALIFIERS = frozenset(
    {
        "arabic",
        "english",
        "french",
        "mandarin",
        "spanish",
    }
)
_TITLE_NUMBER_RE = re.compile(r"\b\d+[a-z]*\b")

_CANDIDATE_EVENT_SELECT = (
    "id,title,description,location,price,food,registration,category,"
    "club,club_id,ig_handle,school_id,cancelled,source_url,source_image_url,"
    f"{school_service.SCHOOL_SLUG_EMBED},"
    "event_dates(dtstart_utc,dtend_utc,duration,tz)"
)


def _fold_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in normalized if not unicodedata.combining(char)).casefold()


def normalize(s: str) -> str:
    """Lowercase + strip non-alphanumeric - used for substring duplicate checks."""
    return re.sub(r"[^a-z0-9]", "", _fold_text(s))


def jaccard_similarity(a: str, b: str) -> float:
    """Word-set Jaccard similarity. Empty strings -> 0.0."""
    set_a = set(re.findall(r"[a-z0-9]+", _fold_text(a)))
    set_b = set(re.findall(r"[a-z0-9]+", _fold_text(b)))
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def sequence_similarity(a: str, b: str) -> float:
    """SequenceMatcher ratio (case-insensitive)."""
    return SequenceMatcher(None, _fold_text(a), _fold_text(b)).ratio()


def title_similarity(a: str, b: str) -> float:
    """Combined title similarity - max of Jaccard and SequenceMatcher.

    Taking the max catches both word-overlap titles ("Movie Night Friday" vs
    "Friday Movie Night") and reordered-but-similar titles.
    """
    return max(jaccard_similarity(a, b), sequence_similarity(a, b))


def confident_duplicate_id(
    *,
    event: dict,
    candidates: list[dict],
    club_id: int | None,
    ig_handle: str | None,
) -> int | None:
    """Return the strongest deterministic same-club duplicate match.

    Candidate gathering remains deliberately broad. This function owns only
    high-confidence identity: matching club and occurrence time, with either
    an exact title or similar title and location. Ambiguous rows stay
    available to Pass 2 instead of being auto-linked.
    """
    ranked: list[tuple[tuple[float, float], int]] = []
    for candidate in candidates:
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, int):
            continue
        score = _confident_duplicate_score(
            event,
            candidate,
            club_id=club_id,
            ig_handle=ig_handle,
        )
        if score is not None:
            ranked.append((score, candidate_id))
    if not ranked:
        return None
    ranked.sort(key=lambda item: (item[0], item[1]))
    return ranked[0][1]


def collapse_duplicate_extractions(
    events: list[dict],
    *,
    club_ids: list[int | None],
    ig_handles: list[str | None],
) -> tuple[list[dict], list[int], int]:
    """Collapse high-confidence duplicate objects emitted by one extraction.

    Returns the merged events, the original index supplying each event's
    resolved club context, and the number of removed duplicates.
    """
    collapsed: list[dict] = []
    source_indexes: list[int] = []

    for index, event in enumerate(events):
        club_id = club_ids[index] if index < len(club_ids) else None
        ig_handle = ig_handles[index] if index < len(ig_handles) else None
        matching_index = None
        for existing_index, existing in enumerate(collapsed):
            existing_source_index = source_indexes[existing_index]
            existing_org_id = (
                club_ids[existing_source_index] if existing_source_index < len(club_ids) else None
            )
            existing_ig = (
                ig_handles[existing_source_index]
                if existing_source_index < len(ig_handles)
                else None
            )
            if not _same_resolved_club(
                club_id,
                ig_handle,
                existing_org_id,
                existing_ig,
            ):
                continue
            if (
                _confident_duplicate_score(
                    event,
                    existing,
                    club_id=club_id,
                    ig_handle=ig_handle,
                    candidate_club_id=existing_org_id,
                    candidate_ig_handle=existing_ig,
                )
                is not None
            ):
                matching_index = existing_index
                break

        if matching_index is None:
            collapsed.append(dict(event))
            source_indexes.append(index)
            continue
        collapsed[matching_index] = _merge_extracted_duplicates(
            collapsed[matching_index],
            event,
        )

    return collapsed, source_indexes, len(events) - len(collapsed)


def _confident_duplicate_score(
    event: dict,
    candidate: dict,
    *,
    club_id: int | None,
    ig_handle: str | None,
    candidate_club_id: int | None = None,
    candidate_ig_handle: str | None = None,
) -> tuple[float, float] | None:
    if candidate_club_id is None:
        candidate_club_id = candidate.get("club_id")
    if candidate_ig_handle is None:
        candidate_ig_handle = candidate.get("ig_handle")
    if not _same_resolved_club(
        club_id,
        ig_handle,
        candidate_club_id,
        candidate_ig_handle,
    ):
        return None

    incoming_title = event.get("title") or ""
    candidate_title = candidate.get("title") or ""
    title_score = title_similarity(incoming_title, candidate_title)
    location_score = jaccard_similarity(
        event.get("location") or "",
        candidate.get("location") or "",
    )
    if title_score <= SCRAPING_TITLE_SIMILARITY_THRESHOLD:
        return None
    # Venue is mutable. An exact title, owner, and occurrence identify the
    # event even when a correction replaces the entire location.
    if (
        normalize(incoming_title) != normalize(candidate_title)
        or (
            "campus" in _fold_text(event.get("location"))
            and "campus" in _fold_text(candidate.get("location"))
        )
    ) and location_score <= SCRAPING_LOCATION_SIMILARITY_THRESHOLD:
        return None
    if _has_conflicting_title_qualifiers(incoming_title, candidate_title):
        return None

    if not _has_exact_occurrence_start(event, candidate):
        return None

    return (-title_score, -location_score)


def _same_resolved_club(
    left_id: int | None,
    left_ig: str | None,
    right_id: int | None,
    right_ig: str | None,
) -> bool:
    if isinstance(left_id, int) and isinstance(right_id, int):
        return left_id == right_id
    normalized_left_ig = (left_ig or "").strip().lstrip("@").casefold()
    normalized_right_ig = (right_ig or "").strip().lstrip("@").casefold()
    return bool(normalized_left_ig and normalized_left_ig == normalized_right_ig)


def _has_conflicting_title_qualifiers(left: str, right: str) -> bool:
    left_text = _fold_text(left)
    right_text = _fold_text(right)
    left_tokens = set(re.findall(r"[a-z0-9]+", left_text))
    right_tokens = set(re.findall(r"[a-z0-9]+", right_text))

    left_languages = left_tokens & _LANGUAGE_QUALIFIERS
    right_languages = right_tokens & _LANGUAGE_QUALIFIERS
    if left_languages != right_languages:
        return True

    left_numbers = set(_TITLE_NUMBER_RE.findall(left_text))
    right_numbers = set(_TITLE_NUMBER_RE.findall(right_text))
    return bool(
        left_numbers
        and right_numbers
        and left_numbers - right_numbers
        and right_numbers - left_numbers
    )


def _candidate_occurrences(event: dict) -> list[dict]:
    occurrences = event.get("occurrences")
    if isinstance(occurrences, list):
        return [item for item in occurrences if isinstance(item, dict)]
    event_dates = event.get("event_dates")
    if isinstance(event_dates, list):
        return [item for item in event_dates if isinstance(item, dict)]
    return []


def _has_exact_occurrence_start(left: dict, right: dict) -> bool:
    left_starts = {
        parsed
        for occurrence in _candidate_occurrences(left)
        if (parsed := parse_iso_datetime(occurrence.get("dtstart_utc"))) is not None
    }
    right_starts = {
        parsed
        for occurrence in _candidate_occurrences(right)
        if (parsed := parse_iso_datetime(occurrence.get("dtstart_utc"))) is not None
    }
    return bool(left_starts & right_starts)


def _merge_extracted_duplicates(existing: dict, incoming: dict) -> dict:
    merged = dict(existing)
    for field in ("title", "description", "location", "club"):
        old_value = str(merged.get(field) or "").strip()
        new_value = str(incoming.get(field) or "").strip()
        if new_value and len(new_value) > len(old_value):
            merged[field] = incoming[field]

    for field in ("price", "category", "source_image_url"):
        if merged.get(field) in (None, "") and incoming.get(field) not in (None, ""):
            merged[field] = incoming[field]

    old_food = merged.get("food")
    if not isinstance(old_food, list):
        old_food = []
    new_food = incoming.get("food")
    if not isinstance(new_food, list):
        new_food = []
    if new_food:
        merged["food"] = list(dict.fromkeys([*old_food, *new_food]))
    merged["registration"] = bool(merged.get("registration") or incoming.get("registration"))
    merged["occurrences"] = _merge_extracted_occurrences(existing, incoming)
    return merged


def _merge_extracted_occurrences(existing: dict, incoming: dict) -> list[dict]:
    merged = [dict(occurrence) for occurrence in _candidate_occurrences(existing)]
    for incoming_occurrence in _candidate_occurrences(incoming):
        incoming_start = parse_iso_datetime(incoming_occurrence.get("dtstart_utc"))
        matching_index = None
        for index, existing_occurrence in enumerate(merged):
            existing_start = parse_iso_datetime(existing_occurrence.get("dtstart_utc"))
            if incoming_start is None or incoming_start != existing_start:
                continue
            matching_index = index
            break
        if matching_index is None:
            merged.append(dict(incoming_occurrence))
            continue
        replacement = dict(merged[matching_index])
        replacement.update(
            {key: value for key, value in incoming_occurrence.items() if value not in (None, "")}
        )
        merged[matching_index] = replacement

    merged.sort(
        key=lambda occurrence: (
            parse_iso_datetime(occurrence.get("dtstart_utc"))
            or datetime.max.replace(tzinfo=timezone.utc)
        )
    )
    return merged


def find_candidates(
    *,
    title: str,
    location: str,
    description: str,
    occurrences: list[dict],
    ig_handle: str | None,
    club_id: int | None = None,
    club_name: str | None = None,
    limit: int = SCRAPING_MAX_CANDIDATES,
    max_cross_org: int = SCRAPING_MAX_CROSS_ORG_CANDIDATES,
) -> list[dict]:
    """Return similar existing events for Pass 2 reconcile.

    Combines:
      1. Same-club future events with similar titles
         (``club_id`` first, else ``ig_handle``).
      2. Same-day events that pass the location/description/title gauntlet,
         plus soft normalized-name matches when org id is unresolved.

    Same-org candidates are ranked first; cross-org same-day rows are capped
    tighter. Empty / missing first-occurrence start time means only
    same-club candidates can be returned.
    """
    same_org_ids: set[int] = set()
    scored: dict[int, tuple[float, dict, bool]] = {}

    for row in _same_club_candidates(
        club_id=club_id,
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
        target_start = parse_iso_datetime(occurrences[0].get("dtstart_utc"))
    if target_start is not None:
        for row in _same_day_candidates(
            target_start=target_start,
            candidate_title=title,
            candidate_location=location,
            candidate_description=description,
            club_id=club_id,
            club_name=club_name,
        ):
            eid = row.get("id")
            if not isinstance(eid, int):
                continue
            score = title_similarity(row.get("title") or "", title)
            is_same_org = eid in same_org_ids or _is_same_org_row(
                row,
                club_id=club_id,
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
    club_id: int | None,
    ig_handle: str | None,
) -> bool:
    if isinstance(club_id, int) and row.get("club_id") == club_id:
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
    out.setdefault("club_id", None)
    return out


def clear_candidate_caches() -> None:
    """Clear in-memory deduplication caches after a successful write."""
    _fetch_org_events_by_id.cache_clear()
    _fetch_org_events_by_ig.cache_clear()
    _fetch_day_events.cache_clear()


@functools.lru_cache(maxsize=128)
def _fetch_org_events_by_id(club_id: int) -> list[dict]:
    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENTS)
            .select(_CANDIDATE_EVENT_SELECT)
            .eq("club_id", club_id)
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


def _same_club_candidates(
    *,
    club_id: int | None,
    ig_handle: str | None,
    candidate_title: str,
) -> list[dict]:
    """Return future same-org events whose title clears the similarity threshold."""

    if isinstance(club_id, int):
        rows = _fetch_org_events_by_id(club_id)
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
            > SCRAPING_SAME_CLUB_TITLE_THRESHOLD
        ):
            out.append(row)
    return out


@functools.lru_cache(maxsize=128)
def _fetch_day_events(day_start_iso: str, day_end_iso: str) -> list[dict]:
    def _page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(EVENT_DATES)
            .select(f"event_id,events({_CANDIDATE_EVENT_SELECT})")
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
    club_id: int | None,
    club_name: str | None,
) -> list[dict]:
    """Return same-UTC-day events that pass the duplicate similarity gauntlet."""
    day_start = target_start.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    soft_name = _normalize_club_name(club_name)
    allow_soft_name = soft_name and not isinstance(club_id, int)

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
            existing_name = _normalize_club_name(event.get("club"))
            if existing_name and existing_name == soft_name:
                out.append(event)

    return out


def _latest_occurrence_end(occurrences: list[dict]) -> datetime | None:
    """Return the latest dtend (or dtstart fallback) across occurrences."""
    candidates: list[datetime] = []
    for occ in occurrences:
        end = parse_iso_datetime(occ.get("dtend_utc")) or parse_iso_datetime(occ.get("dtstart_utc"))
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


# Captures the shortcode from /p/, /reel/, /reels/, or /tv/ paths (query/fragment-safe).
_SHORTCODE_RE = re.compile(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)")


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
