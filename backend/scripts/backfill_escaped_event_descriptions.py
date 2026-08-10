#!/usr/bin/env python3
"""Repair Instagram event descriptions containing serialized JSON escapes.

The extractor previously persisted strings such as ``\\ud83d\\udcca`` and
``\\n`` literally, so event details showed escape syntax instead of emoji and
line breaks. The operation is re-runnable because already-normalized rows are
ignored. Without ``--apply`` it reports the affected rows and writes nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.database import supabase_admin  # noqa: E402
from core.sanitize import normalize_scraped_text  # noqa: E402
from core.tables import EVENTS  # noqa: E402

_PAGE_SIZE = 1000


def description_repairs(rows: list[dict[str, Any]]) -> list[tuple[dict[str, Any], str]]:
    """Return rows whose descriptions change under canonical normalization."""
    repairs: list[tuple[dict[str, Any], str]] = []
    for row in rows:
        description = row.get("description")
        if not isinstance(description, str):
            continue
        normalized = normalize_scraped_text(description)
        if normalized is not None and normalized != description:
            repairs.append((row, normalized))
    return repairs


def _instagram_event_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = (
            supabase_admin.table(EVENTS)
            .select("id,title,description")
            .eq("ingestion_source", "instagram_scraper")
            .not_.is_("description", "null")
            .range(offset, offset + _PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write repaired descriptions")
    args = parser.parse_args()

    repairs = description_repairs(_instagram_event_rows())
    print(f"found {len(repairs)} Instagram event descriptions with serialized escapes")
    for row, normalized in repairs:
        print(f"  {row['id']}: {row.get('title') or '(untitled)'}")
        if args.apply:
            (
                supabase_admin.table(EVENTS)
                .update({"description": normalized})
                .eq("id", row["id"])
                .execute()
            )

    verb = "updated" if args.apply else "would update"
    print(f"{verb} {len(repairs)} events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
