#!/usr/bin/env python3
"""
Normalize event categories in the DB to the canonical 22.
Maps legacy values (e.g. Academic -> Academics) and sets unknown to "Academics".

Usage (from backend/):
  python scripts/normalize_event_categories.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb
from core.tables import EVENTS
from constants import EVENT_CATEGORIES, CATEGORY_NORMALIZE_MAP


def main() -> None:
    sb = get_sb()
    r = sb.table(EVENTS).select("id, title, category").execute()
    events = r.data or []
    updated = 0
    for row in events:
        cat = row.get("category")
        if cat is None or cat.strip() == "":
            new_cat = "Academics"
        elif cat in EVENT_CATEGORIES:
            continue
        else:
            new_cat = CATEGORY_NORMALIZE_MAP.get(cat, "Academics")
        sb.table(EVENTS).update({"category": new_cat}).eq("id", row["id"]).execute()
        print(f"id={row['id']} {cat!r} -> {new_cat!r}")
        updated += 1
    print(f"Done. Updated {updated} events.")


if __name__ == "__main__":
    main()
