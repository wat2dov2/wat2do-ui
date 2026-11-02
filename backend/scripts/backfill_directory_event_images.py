#!/usr/bin/env python3
"""Backfill posters for directory events that have none.

New directory events get their poster from the event page's og:image, read
server-side (``services.scraper.page_image``). Events ingested before that
existed have ``source_image_url`` NULL and fall back to the directory club's
logo. This reads each posterless directory event's source page, copies its
og:image to storage, and sets ``events.source_image_url``.

A poster that many events share is a site default (a "no image" placeholder or
the school's logo), so it is dropped and those events keep their club-logo
fallback. A rerun only revisits events still missing a poster, and pages are
read one at a time with a pause between them. Without ``--apply`` nothing is
uploaded or written.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_EVENT_IMAGES  # noqa: E402
from core.database import get_sb  # noqa: E402
from core.pagination import fetch_all_pages  # noqa: E402
from core.tables import EVENTS  # noqa: E402
from services.scraper.image_uploader import upload_image_from_url  # noqa: E402
from services.scraper.page_image import fetch_event_poster  # noqa: E402

# An og:image shared by this many events is the site's default, not a poster.
SHARED_DEFAULT_COUNT = 5


def posterless_directory_events() -> list[dict]:
    """Directory events with a source page but no stored poster."""
    sb = get_sb()
    return fetch_all_pages(
        lambda offset, page_size: (
            (
                sb.table(EVENTS)
                .select("id,source_url")
                .eq("ingestion_source", "directory")
                .is_("source_image_url", "null")
                .not_.is_("source_url", "null")
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )


def candidate_posters(events: list[dict], *, delay: float) -> dict[int, str]:
    """Read each event page's og:image, skipping pages that advertise none."""
    found: dict[int, str] = {}
    for index, event in enumerate(events, 1):
        source_url = str(event.get("source_url") or "")
        poster = fetch_event_poster(source_url) if source_url else None
        if poster:
            found[int(event["id"])] = poster
        if index % 50 == 0:
            print(f"  read {index}/{len(events)} pages, {len(found)} posters so far")
        time.sleep(delay)
    return found


def without_shared_defaults(found: dict[int, str]) -> dict[int, str]:
    """Drop posters that several events share: those are the site's default image."""
    counts = Counter(found.values())
    return {event_id: url for event_id, url in found.items() if counts[url] < SHARED_DEFAULT_COUNT}


def store(posters: dict[int, str], *, apply: bool) -> Counter[str]:
    stats: Counter[str] = Counter()
    sb = get_sb()
    for event_id, poster in posters.items():
        if not apply:
            stats["would_store"] += 1
            continue
        stored = upload_image_from_url(poster, bucket=BUCKET_EVENT_IMAGES, allow_all_domains=True)
        if stored:
            sb.table(EVENTS).update({"source_image_url": stored}).eq("id", event_id).execute()
            stats["stored"] += 1
        else:
            stats["download_failed"] += 1
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill posters for directory events missing one."
    )
    parser.add_argument(
        "--apply", action="store_true", help="Upload posters and write source_image_url."
    )
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N events.")
    parser.add_argument(
        "--delay", type=float, default=0.5, help="Seconds to wait between event pages."
    )
    args = parser.parse_args()

    events = posterless_directory_events()
    if args.limit is not None:
        events = events[: args.limit]
    print(f"{len(events)} directory event(s) without a poster")

    found = candidate_posters(events, delay=args.delay)
    posters = without_shared_defaults(found)
    print(
        f"{len(found)} have an og:image; dropped {len(found) - len(posters)} shared/default; "
        f"{len(posters)} to store"
    )

    stats = store(posters, apply=args.apply)
    print(("Applied" if args.apply else "Dry run") + f": {dict(stats)}")
    if not args.apply:
        print("Re-run with --apply to upload posters and update events.")


if __name__ == "__main__":
    main()
