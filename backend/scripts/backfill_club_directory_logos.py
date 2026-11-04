#!/usr/bin/env python3
"""Backfill club logos from the school directory pages in ``clubs.club_page``.

Covers clubs with no logo and no Instagram handle (clubs with a handle get
their logo from the ingestion processor's logged-out profile reads). Three
directory platforms publish club logos to a plain request:

- Campus Labs Engage (``/organization/<key>``): its public discovery API names
  the profile picture, and the club's Instagram when it lists one. That handle
  is saved too, so the club's Instagram picture becomes its logo when the
  directory has none.
- CampusGroups: the club page header carries the club's logo, or the school's
  logo when the club never uploaded one.
- Penn Clubs: its public club API has ``image_url``.

A picture shared by several clubs on one host is the school's default, so it is
skipped. Pages are read one at a time with a pause between requests. Each
logo is copied to media storage before ``clubs.logo_url`` is set, so a rerun only visits
clubs that are still missing one. Without ``--apply`` nothing is uploaded or
written.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_CLUB_LOGOS  # noqa: E402
from core.database import get_sb  # noqa: E402
from core.pagination import fetch_all_pages  # noqa: E402
from core.tables import CLUBS  # noqa: E402
from schemas.club import ClubUpdate  # noqa: E402
from services import club_service  # noqa: E402
from services.instagram_follow.candidates import normalize_handle  # noqa: E402
from services.scraper.image_uploader import upload_image_from_url  # noqa: E402

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
_ENGAGE_PATH = re.compile(r"^/organization/([^/?#]+)/?$")
_PENN_PATH = re.compile(r"^/club/([^/?#]+)/?$")
_CAMPUSGROUPS_LOGO = re.compile(
    r'<img[^>]*class="[^"]*content-menu_club_logo[^"]*"[^>]*\bsrc="([^"]+)"'
)
_ENGAGE_IMAGES = "https://se-images.campuslabs.com/clink/images/"
# A picture used by this many clubs on one host is the school's own logo.
SHARED_DEFAULT_COUNT = 3


def clubs_without_logos() -> list[dict[str, Any]]:
    """Clubs with a directory page and neither a logo nor an Instagram handle."""
    sb = get_sb()
    return fetch_all_pages(
        lambda offset, page_size: (
            (
                sb.table(CLUBS)
                .select("id,club_name,club_page")
                .is_("logo_url", "null")
                .is_("ig", "null")
                .not_.is_("club_page", "null")
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )


def engage_organization(client: httpx.Client, page_url: str) -> dict[str, Any] | None:
    """An Engage club page's public organization record, or None for other pages."""
    parts = urlsplit(page_url)
    match = _ENGAGE_PATH.match(parts.path)
    if not match:
        return None
    response = client.get(
        f"{parts.scheme}://{parts.netloc}/api/discovery/organization/bykey/{match.group(1)}"
    )
    if response.status_code != 200 or "json" not in response.headers.get("content-type", ""):
        return None
    data = response.json()
    return data if isinstance(data, dict) else None


def directory_instagram(client: httpx.Client, page_url: str) -> str | None:
    """The Instagram handle an Engage club page lists, or None."""
    try:
        organization = engage_organization(client, page_url) or {}
    except (httpx.HTTPError, ValueError):
        return None
    url = str((organization.get("socialMedia") or {}).get("InstagramUrl") or "")
    parts = urlsplit(url)
    if (parts.hostname or "").lower().removeprefix("www.") != "instagram.com":
        return None
    return normalize_handle(parts.path.strip("/").split("/", 1)[0])


def directory_logo(client: httpx.Client, page_url: str) -> str | None:
    """The club logo a directory page publishes, or None."""
    parts = urlsplit(page_url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    origin = f"{parts.scheme}://{parts.netloc}"
    try:
        if host == "pennclubs.com" and (match := _PENN_PATH.match(parts.path)):
            data = client.get(f"{origin}/api/clubs/{match.group(1)}/").json()
            return data.get("image_url") or None
        if _ENGAGE_PATH.match(parts.path):
            organization = engage_organization(client, page_url) or {}
            picture = organization.get("profilePicture")
            return f"{_ENGAGE_IMAGES}{picture}?preset=med-sq" if picture else None
        response = client.get(page_url)
        if response.status_code != 200:
            return None
        if match := _CAMPUSGROUPS_LOGO.search(response.text):
            return urljoin(str(response.url), match.group(1))
    except (httpx.HTTPError, ValueError, AttributeError):
        return None
    return None


def without_shared_defaults(found: dict[int, str]) -> dict[int, str]:
    """Drop pictures that several clubs share: those are the school's logo."""
    counts = Counter(found.values())
    return {club_id: url for club_id, url in found.items() if counts[url] < SHARED_DEFAULT_COUNT}


def find_logos(
    clubs: list[dict[str, Any]], *, delay: float
) -> tuple[dict[int, str], dict[int, str]]:
    """Each club's directory logo, and the Instagram handles of those without one."""
    found: dict[int, str] = {}
    handles: dict[int, str] = {}
    with httpx.Client(
        timeout=20, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
    ) as client:
        for index, club in enumerate(clubs, 1):
            page_url = str(club["club_page"])
            logo = directory_logo(client, page_url)
            if logo:
                found[int(club["id"])] = logo
            if handle := directory_instagram(client, page_url):
                handles[int(club["id"])] = handle
            if index % 50 == 0:
                print(
                    f"  read {index}/{len(clubs)} pages, {len(found)} logos and "
                    f"{len(handles)} Instagram handles so far"
                )
            time.sleep(delay)
    logos = without_shared_defaults(found)
    # Including a club whose only logo was the school's default.
    return logos, {club_id: h for club_id, h in handles.items() if club_id not in logos}


def store_handles(handles: dict[int, str]) -> int:
    """Save each handle; the ingestion processor then reads its picture as the logo."""
    return sum(
        1
        for club_id, handle in handles.items()
        if club_service.update_club(club_id, ClubUpdate(ig=handle))
    )


def store_logos(logos: dict[int, str]) -> tuple[int, int]:
    updated = failed = 0
    for club_id, source_url in logos.items():
        logo_url = upload_image_from_url(
            source_url, bucket=BUCKET_CLUB_LOGOS, allow_all_domains=True
        )
        if logo_url and club_service.update_club(club_id, ClubUpdate(logo_url=logo_url)):
            updated += 1
        else:
            failed += 1
            print(f"  failed: {club_id}")
    return updated, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Store the logos and update clubs")
    parser.add_argument("--limit", type=int, help="Only read this many club pages")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between page reads")
    args = parser.parse_args()

    clubs = clubs_without_logos()[: args.limit]
    print(f"{len(clubs)} clubs with a directory page and no logo or Instagram handle")
    logos, handles = find_logos(clubs, delay=args.delay)
    hosts = Counter(
        urlsplit(str(club["club_page"])).hostname for club in clubs if int(club["id"]) in logos
    )
    print(f"{len(logos)} logos found: {dict(hosts.most_common())}")
    print(f"{len(handles)} Instagram handles found on clubs without a directory logo")
    if not args.apply:
        print("Dry run only. Re-run with --apply to upload logos and update clubs.")
        return 0
    updated, failed = store_logos(logos)
    print(f"updated {updated}, failed {failed}, {store_handles(handles)} handles saved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
