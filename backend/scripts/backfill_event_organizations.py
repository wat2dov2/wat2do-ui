#!/usr/bin/env python3
"""
Backfill missing event organization/display labels.

Usage (from backend/):
  python scripts/backfill_event_organizations.py           # dry-run
  python scripts/backfill_event_organizations.py --apply   # update rows
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import CLUBS, EVENTS

log = logging.getLogger(__name__)

FALLBACK_ORGANIZATION = "Campus Event"
UPDATE_CHUNK_SIZE = 500


def _clean(value: object) -> str:
    return str(value or "").strip()


def _normalize_handle(value: object) -> str:
    return _clean(value).lstrip("@").lower()


def _display_handle(value: object) -> str | None:
    handle = _clean(value).lstrip("@")
    return f"@{handle}" if handle else None


def _load_clubs_by_ig() -> dict[str, str]:
    sb = get_sb()

    def _fetch(offset: int, ps: int) -> list[dict]:
        result = (
            sb.table(CLUBS)
            .select("club_name,ig")
            .order("id")
            .range(offset, offset + ps - 1)
            .execute()
        )
        return result.data or []

    clubs: dict[str, str] = {}
    for row in iter_all_pages(_fetch):
        handle = _normalize_handle(row.get("ig"))
        club_name = _clean(row.get("club_name"))
        if handle and club_name:
            clubs[handle] = club_name
    return clubs


def _resolve_label(row: dict, clubs_by_ig: dict[str, str]) -> tuple[str, str | None, str]:
    ig_handle = _normalize_handle(row.get("ig_handle"))
    if ig_handle:
        display = _display_handle(ig_handle)
        club_name = clubs_by_ig.get(ig_handle)
        if club_name:
            return club_name, display, "club_match"
        return display or FALLBACK_ORGANIZATION, display, "handle_fallback"

    existing_display = _clean(row.get("display_handle"))
    if existing_display:
        return existing_display, existing_display, "display_handle_fallback"

    return FALLBACK_ORGANIZATION, None, "campus_fallback"


def _chunked(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write missing labels to the DB.")
    args = parser.parse_args()

    sb = get_sb()
    clubs_by_ig = _load_clubs_by_ig()

    def _fetch_events(offset: int, ps: int) -> list[dict]:
        result = (
            sb.table(EVENTS)
            .select("id,title,organization,display_handle,ig_handle")
            .order("id")
            .range(offset, offset + ps - 1)
            .execute()
        )
        return result.data or []

    grouped_updates: dict[tuple[str, str | None], list[int]] = defaultdict(list)
    reason_counts: Counter[str] = Counter()

    for row in iter_all_pages(_fetch_events):
        organization = _clean(row.get("organization"))
        if organization:
            continue
        resolved_organization, resolved_display, reason = _resolve_label(row, clubs_by_ig)
        grouped_updates[(resolved_organization, resolved_display)].append(row["id"])
        reason_counts[reason] += 1

    total_updates = sum(len(ids) for ids in grouped_updates.values())
    log.info("Plan: %d events across %d grouped updates.", total_updates, len(grouped_updates))
    for reason, count in reason_counts.most_common():
        log.info("  %s: %d", reason, count)

    previewed = 0
    for (organization, display_handle), ids in grouped_updates.items():
        log.info("ids=%s organization=%r display_handle=%r", ids[:8], organization, display_handle)
        previewed += 1
        if previewed >= 20:
            break
    if len(grouped_updates) > previewed:
        log.info(
            "... %d more grouped updates omitted from preview", len(grouped_updates) - previewed
        )

    if not args.apply:
        log.info("Dry-run complete. Re-run with --apply to execute updates.")
        return

    applied = 0
    for (organization, display_handle), ids in grouped_updates.items():
        payload = {"organization": organization}
        if display_handle:
            payload["display_handle"] = display_handle
        for chunk in _chunked(ids, UPDATE_CHUNK_SIZE):
            sb.table(EVENTS).update(payload).in_("id", chunk).execute()
            applied += len(chunk)

    log.info("Applied %d event label updates.", applied)


if __name__ == "__main__":
    main()
