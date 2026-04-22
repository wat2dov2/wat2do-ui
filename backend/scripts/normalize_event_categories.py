#!/usr/bin/env python3
"""
Normalize event categories in the DB to the canonical 22.
Maps legacy values (e.g. Academic -> Academics) and surfaces unknown ones.

Usage (from backend/):
  python scripts/normalize_event_categories.py           # dry-run: print planned changes
  python scripts/normalize_event_categories.py --apply   # execute updates
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import EVENTS
from core.constants import EVENT_CATEGORIES, CATEGORY_NORMALIZE_MAP

log = logging.getLogger(__name__)


def _plan_update(cat: str | None) -> str | None:
    """Return the canonical category for *cat*, or ``None`` if no change needed.

    Returns an empty string (``""``) as a sentinel for "unknown category —
    do not auto-bucket to Academics" per audit M10: silently coercing
    typos like ``"Techno1ogy"`` into ``Academics`` loses the original
    meaning.  Callers can treat ``""`` as "leave untouched; log for
    manual review".
    """
    if cat is None or cat.strip() == "":
        return "Academics"  # empty -> Academics is still safe
    if cat in EVENT_CATEGORIES:
        return None  # already canonical
    mapped = CATEGORY_NORMALIZE_MAP.get(cat)
    if mapped:
        return mapped
    return ""  # unknown -- surface instead of silently bucketing


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the updates (default is a dry-run that only prints the plan).",
    )
    args = parser.parse_args()

    sb = get_sb()

    # Use iter_all_pages to bypass the PostgREST 1000-row default cap and
    # stream the full events table instead of silently truncating to the
    # first page (audit M10).
    def _fetch(offset: int, ps: int) -> list[dict]:
        r = (
            sb.table(EVENTS)
            .select("id, title, category")
            .order("id")
            .range(offset, offset + ps - 1)
            .execute()
        )
        return r.data or []

    # Collect planned changes first so we can emit one UPDATE per row in
    # a predictable order, and so unknowns can be reported in a single
    # batch at the end.
    planned: list[tuple[int, str | None, str]] = []
    unknowns: list[tuple[int, str]] = []

    for row in iter_all_pages(_fetch):
        cat = row.get("category")
        plan = _plan_update(cat)
        if plan is None:
            continue
        if plan == "":
            # Unknown value — log for manual triage, never silently map
            # to Academics (audit M10).
            unknowns.append((row["id"], cat or ""))
            continue
        planned.append((row["id"], cat, plan))

    log.info(
        "Plan: %d updates, %d unknowns requiring manual review.",
        len(planned),
        len(unknowns),
    )

    for eid, old, new in planned:
        log.info("id=%s %r -> %r", eid, old, new)

    if unknowns:
        log.warning("Unknown categories (NOT auto-bucketed):")
        for eid, val in unknowns:
            log.warning("  id=%s category=%r", eid, val)

    if not args.apply:
        log.info("Dry-run complete. Re-run with --apply to execute updates.")
        return

    # Apply updates.  We execute each update individually because the
    # Supabase Python SDK does not expose a transaction API; the caller
    # must ensure the table is not concurrently edited during the sweep
    # (or schedule during a maintenance window).  Idempotency: rerunning
    # skips rows that already have canonical values (see _plan_update).
    updated = 0
    for eid, _old, new in planned:
        sb.table(EVENTS).update({"category": new}).eq("id", eid).execute()
        updated += 1

    log.info("Applied %d updates. %d unknowns left untouched.", updated, len(unknowns))


if __name__ == "__main__":
    main()
