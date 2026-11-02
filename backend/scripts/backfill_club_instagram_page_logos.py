#!/usr/bin/env python3
"""Backfill club logos from each club's public Instagram profile page.

A logged-out request for ``instagram.com/<handle>/`` returns the profile picture
in the page's ``og:image`` tag, so no school account is involved and no Brave
profile read is spent. Pages are read one at a time with a pause between
requests, and the run stops as soon as Instagram starts refusing them (a rate
limit or a login wall) rather than pushing on. A handle whose page has no
picture (a deleted or renamed account, or the default avatar) is skipped. Each
logo is copied to S3 before ``clubs.logo_url`` is set, so a rerun only visits
clubs that are still missing one. Without ``--apply`` nothing is uploaded or
written.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_CLUB_LOGOS  # noqa: E402
from core.database import get_sb  # noqa: E402
from core.pagination import fetch_all_pages  # noqa: E402
from core.tables import CLUBS  # noqa: E402
from schemas.club import ClubUpdate  # noqa: E402
from services import club_service  # noqa: E402
from services.instagram_notifications.club_logos import instagram_handle  # noqa: E402
from services.scraper.image_uploader import upload_image_from_url  # noqa: E402

_OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')
# Instagram's grey silhouette for accounts that never set a picture.
_DEFAULT_AVATAR = "44884218_345707102882519_2446069589734326272_n"
# This many refused pages in a row means Instagram is limiting this IP: stop.
REFUSED_IN_A_ROW = 3


class Refused(Exception):
    """Instagram answered with a rate limit or a login wall instead of the page."""


def clubs_by_handle() -> dict[str, list[int]]:
    """Logo-less club ids by Instagram handle."""
    sb = get_sb()
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                sb.table(CLUBS)
                .select("id,ig")
                .is_("logo_url", "null")
                .not_.is_("ig", "null")
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )
    clubs: dict[str, list[int]] = defaultdict(list)
    for row in rows:
        if handle := instagram_handle(row.get("ig")):
            clubs[handle].append(int(row["id"]))
    return clubs


def profile_picture(client: httpx.Client, handle: str) -> str | None:
    """The picture on a public profile page, or None when the page has none."""
    response = client.get(f"https://www.instagram.com/{handle}/")
    if response.status_code == 429 or "/accounts/login" in str(response.url):
        raise Refused(f"{response.status_code} {response.url}")
    if response.status_code != 200:
        return None
    match = _OG_IMAGE.search(response.text)
    if not match:
        return None
    picture = html.unescape(match.group(1))
    return None if _DEFAULT_AVATAR in picture else picture


def backfill(clubs: dict[str, list[int]], *, delay: float, apply: bool) -> dict[str, int]:
    stats = {"pages": 0, "found": 0, "no_picture": 0, "updated": 0, "failed": 0}
    refused = 0
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for handle, club_ids in clubs.items():
            try:
                picture = profile_picture(client, handle)
                refused = 0
            except Refused as exc:
                refused += 1
                print(f"  refused at {handle}: {exc}")
                if refused >= REFUSED_IN_A_ROW:
                    print("  Instagram is refusing pages; stopping. Rerun later.")
                    break
                time.sleep(delay * 10)
                continue
            except httpx.HTTPError:
                picture = None
            stats["pages"] += 1
            if not picture:
                stats["no_picture"] += 1
                print(f"  no picture: {handle}")
            else:
                stats["found"] += 1
                if apply:
                    logo_url = upload_image_from_url(picture, bucket=BUCKET_CLUB_LOGOS)
                    for club_id in club_ids:
                        if logo_url and club_service.update_club(
                            club_id, ClubUpdate(logo_url=logo_url)
                        ):
                            stats["updated"] += 1
                        else:
                            stats["failed"] += 1
            if stats["pages"] % 50 == 0:
                print(f"  read {stats['pages']}/{len(clubs)} pages: {stats}")
            time.sleep(delay)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Upload to S3 and update clubs")
    parser.add_argument("--limit", type=int, help="Only read this many profile pages")
    parser.add_argument("--delay", type=float, default=3.0, help="Seconds between page reads")
    args = parser.parse_args()

    clubs = clubs_by_handle()
    if args.limit:
        clubs = dict(list(clubs.items())[: args.limit])
    print(f"{len(clubs)} Instagram handles on clubs with no logo")
    stats = backfill(clubs, delay=args.delay, apply=args.apply)
    print(("" if args.apply else "DRY RUN ") + str(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
