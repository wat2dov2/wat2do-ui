#!/usr/bin/env python3
"""
Delete events from the DB by title (exact match).

Usage:
  python scripts/delete_events.py "UWMUN Events" "Board Game Night" "Test Event"
"""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import async_session
from models.event import Event


async def main(titles: list[str]) -> None:
    titles = [t.strip() for t in titles if t.strip()]
    if not titles:
        print("Provide one or more event titles.")
        raise SystemExit(1)

    async with async_session() as db:
        existing = (
            await db.execute(select(Event.id, Event.title, Event.organization).where(Event.title.in_(titles)))
        ).all()

        if not existing:
            print("No matching events found.")
            return

        print("Deleting:")
        for row in existing:
            print(f"  id={row.id} title={row.title!r} org={(row.organization or '')!r}")

        result = await db.execute(delete(Event).where(Event.title.in_(titles)))
        await db.commit()
        deleted = result.rowcount or 0
        print(f"\nDeleted {deleted} event(s).")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))

