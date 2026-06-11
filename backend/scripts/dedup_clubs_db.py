#!/usr/bin/env python3
"""Remove duplicate (school, club_name) rows from the Supabase ``clubs`` table.

The first import_master_clubs_xlsx.py run inserted 3,310 rows from an xlsx
that contained 24 duplicate (School, Name) pairs.  After deduping the
xlsx, those 24 dup pairs are orphaned in the DB (each key has 2 rows but
the xlsx now only has 1).  This script keeps the lowest-id row per key
and deletes the rest.

Usage (from backend/):
  python scripts/dedup_clubs_db.py            # dry-run report
  python scripts/dedup_clubs_db.py --apply    # delete the orphans
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb
from core.tables import CLUBS

log = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Delete duplicate rows.  Without this flag, only reports the diff.")
    args = parser.parse_args()

    sb = get_sb()

    # Pull every clubs row (paginate past the 1000 default).
    page_size = 1000
    offset = 0
    all_rows: list[dict] = []
    while True:
        res = (
            sb.table(CLUBS)
              .select("id, school, club_name")
              .range(offset, offset + page_size - 1)
              .execute()
        )
        batch = res.data or []
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    log.info("scanned %s clubs rows", len(all_rows))

    # Group by (school, club_name).
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in all_rows:
        school = (row.get("school") or "").strip()
        name = (row.get("club_name") or "").strip()
        if school and name:
            groups[(school, name)].append(row)

    to_delete: list[dict] = []
    for key, rows in groups.items():
        if len(rows) <= 1:
            continue
        # Keep the lowest id (oldest row); drop the rest.
        rows_sorted = sorted(rows, key=lambda r: r["id"])
        keep, drop = rows_sorted[0], rows_sorted[1:]
        log.info("dup %r | %r — keep id=%s, drop ids=%s",
                 key[0], key[1], keep["id"], [r["id"] for r in drop])
        to_delete.extend(drop)

    log.info("duplicate groups: %s", sum(1 for v in groups.values() if len(v) > 1))
    log.info("rows to delete: %s", len(to_delete))

    if not args.apply:
        log.info("Dry run only.  Pass --apply to delete.")
        return 0

    for row in to_delete:
        sb.table(CLUBS).delete().eq("id", row["id"]).execute()

    log.info("deleted %s rows", len(to_delete))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
