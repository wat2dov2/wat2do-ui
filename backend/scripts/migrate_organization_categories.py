#!/usr/bin/env python3
"""
Migrate legacy organization category tags in public.clubs to canonical values.

Usage (from backend/):
  python scripts/migrate_organization_categories.py           # dry-run
  python scripts/migrate_organization_categories.py --apply   # update rows
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.constants.organizations import canonicalize_organization_categories
from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import CLUBS

log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write migrated categories to the DB.")
    args = parser.parse_args()

    sb = get_sb()
    changed = 0
    skipped = 0

    def _fetch(offset: int, page_size: int) -> list[dict]:
        result = (
            sb.table(CLUBS)
            .select("id, club_name, categories")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        return result.data or []

    for row in iter_all_pages(_fetch):
        raw = row.get("categories") or []
        if not isinstance(raw, list):
            log.warning("Club %s has non-list categories: %r", row.get("id"), raw)
            skipped += 1
            continue

        migrated = canonicalize_organization_categories(raw) or []
        if migrated == raw:
            continue

        changed += 1
        log.info(
            "Club %s (%s): %s -> %s",
            row.get("id"),
            row.get("club_name"),
            raw,
            migrated,
        )
        if args.apply:
            sb.table(CLUBS).update({"categories": migrated}).eq("id", row["id"]).execute()

    if args.apply:
        log.info("Applied category migration to %s club(s). Skipped %s.", changed, skipped)
    else:
        log.info("Dry run: %s club(s) would change. Skipped %s. Pass --apply to write.", changed, skipped)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
