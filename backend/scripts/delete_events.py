#!/usr/bin/env python3
"""
Delete events from the DB by title (exact match).

Usage:
  python scripts/delete_events.py "UWMUN Events" "Board Game Night" "Test Event"
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb


def main(titles: list[str]) -> None:
    titles = [t.strip() for t in titles if t.strip()]
    if not titles:
        print("Provide one or more event titles.")
        raise SystemExit(1)

    sb = get_sb()
    for title in titles:
        r = sb.table("events").select("id, title, organization").eq("title", title).execute()
        if not r.data:
            continue
        for row in r.data:
            print(f"Deleting id={row['id']} title={row['title']!r} org={row.get('organization') or ''!r}")
            sb.table("events").delete().eq("id", row["id"]).execute()
    print("Done.")


if __name__ == "__main__":
    main(sys.argv[1:])
