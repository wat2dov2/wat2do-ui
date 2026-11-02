"""Club logos from the public Instagram profiles of clubs that have a handle but no logo.

The logged-out profile read (``fetch_profile``) carries the profile picture, so no
account is involved. One handle is read at a time, ``club_logo_read_delay_seconds``
apart, and a refused read pauses this lane together with the post fetches. A handle
is read again only after ``club_logo_retry_days``, so a deleted or renamed account is
not asked for over and over. Instagram's picture links expire, so each one is copied
to S3 right away.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

from core.constants import BUCKET_CLUB_LOGOS
from core.database import get_sb
from core.launch_agents import atomic_write
from core.pagination import fetch_all_pages
from core.tables import CLUBS
from schemas.club import ClubUpdate
from services import club_service
from services.ingestion.instagram_fetch import fetch_profile
from services.ingestion.items import CONTROL
from services.instagram_follow.candidates import normalize_handle
from services.scraper.image_uploader import upload_image_from_url


class ClubLogos:
    """Hands out one logo-less club handle at a time and stores what its profile shows."""

    def __init__(self, state_path: Path) -> None:
        self._state_path = state_path
        self._read_at: dict[str, float] = _load(state_path)
        self._waiting: dict[str, list[int]] = {}
        self._listed_at = 0.0

    def fill_next(self) -> bool:
        """Read one handle's profile; False when none is due."""
        handle = self._next_handle()
        if handle is None:
            return False
        club_ids = self._waiting.pop(handle)
        # Recorded before the read, so a refused or failing handle still waits its turn.
        self._read_at[handle] = time.time()
        atomic_write(self._state_path, json.dumps(self._read_at).encode())
        picture = fetch_profile(handle, post_limit=0).get("profile_picture_url")
        logo_url = upload_image_from_url(picture, bucket=BUCKET_CLUB_LOGOS) if picture else None
        for club_id in club_ids if logo_url else []:
            club_service.update_club(club_id, ClubUpdate(logo_url=logo_url))
        return True

    def _next_handle(self) -> str | None:
        if (
            not self._waiting
            and time.monotonic() - self._listed_at >= CONTROL.retry_backoff_seconds
        ):
            self._listed_at = time.monotonic()
            retry_after = time.time() - CONTROL.club_logo_retry_days * 86400
            self._waiting = {
                handle: club_ids
                for handle, club_ids in _clubs_without_logos().items()
                if self._read_at.get(handle, 0.0) < retry_after
            }
        return next(iter(self._waiting), None)


def _clubs_without_logos() -> dict[str, list[int]]:
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
        if handle := normalize_handle(row.get("ig")):
            clubs[handle].append(int(row["id"]))
    return clubs


def _load(path: Path) -> dict[str, float]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}
