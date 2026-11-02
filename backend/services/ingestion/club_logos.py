"""Club logos and names from the public Instagram profiles of clubs that still need them.

The logged-out profile read (``fetch_profile``) carries both the profile picture and the
account's name, so no account is involved. The processor reads one handle at a time,
``club_logo_read_delay_seconds`` apart, to fill a missing logo and to replace a
placeholder "@handle" name (left by older ingestion) with the real one. A refused read
pauses this lane together with the post fetches. A handle is read again only after
``club_logo_retry_days``, so a deleted or renamed account is not asked for over and over.
Instagram's picture links expire, so each one is copied to S3 right away.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

from core.constants import BUCKET_CLUB_LOGOS, MAX_CLUB_NAME_LENGTH
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


def _is_placeholder_name(name: str | None) -> bool:
    """A club named just its "@handle" was stubbed by older ingestion, not a real name."""
    return bool(name) and name.startswith("@")


class ClubLogos:
    """Hands out one club handle at a time and stores the logo and name its profile shows."""

    def __init__(self, state_path: Path) -> None:
        self._state_path = state_path
        self._read_at: dict[str, float] = _load(state_path)
        self._waiting: dict[str, list[dict]] = {}
        # -inf, not 0.0: the first listing must happen even when time.monotonic() has
        # not yet passed retry_backoff_seconds (it can be small on a freshly booted host).
        self._listed_at = float("-inf")

    def fill_next(self) -> bool:
        """Read one handle's profile; False when none is due."""
        handle = self._next_handle()
        if handle is None:
            return False
        clubs = self._waiting.pop(handle)
        # Recorded before the read, so a refused or failing handle still waits its turn.
        self._read_at[handle] = time.time()
        atomic_write(self._state_path, json.dumps(self._read_at).encode())
        profile = fetch_profile(handle, post_limit=0)
        name = (profile.get("name") or "").strip()
        picture = profile.get("profile_picture_url")
        logo_url = (
            upload_image_from_url(picture, bucket=BUCKET_CLUB_LOGOS)
            if picture and any(club["logo_url"] is None for club in clubs)
            else None
        )
        for club in clubs:
            update: dict[str, str] = {}
            if logo_url and club["logo_url"] is None:
                update["logo_url"] = logo_url
            if name and not name.startswith("@") and _is_placeholder_name(club["club_name"]):
                update["club_name"] = name[:MAX_CLUB_NAME_LENGTH]
            if update:
                club_service.update_club(int(club["id"]), ClubUpdate(**update))
        return True

    def _next_handle(self) -> str | None:
        if (
            not self._waiting
            and time.monotonic() - self._listed_at >= CONTROL.retry_backoff_seconds
        ):
            self._listed_at = time.monotonic()
            retry_after = time.time() - CONTROL.club_logo_retry_days * 86400
            self._waiting = {
                handle: clubs
                for handle, clubs in _clubs_needing_profile().items()
                if self._read_at.get(handle, 0.0) < retry_after
            }
        return next(iter(self._waiting), None)


def _clubs_needing_profile() -> dict[str, list[dict]]:
    """By Instagram handle, the clubs still missing a logo or still named "@handle"."""
    sb = get_sb()

    def _rows(apply_filter) -> list[dict]:
        return fetch_all_pages(
            lambda offset, page_size: (
                (
                    apply_filter(
                        sb.table(CLUBS).select("id,ig,club_name,logo_url").not_.is_("ig", "null")
                    )
                    .order("id")
                    .range(offset, offset + page_size - 1)
                    .execute()
                ).data
                or []
            )
        )

    by_id = {
        int(row["id"]): row
        for row in [
            *_rows(lambda q: q.is_("logo_url", "null")),
            *_rows(lambda q: q.like("club_name", "@%")),
        ]
    }
    clubs: dict[str, list[dict]] = defaultdict(list)
    for row in by_id.values():
        if handle := normalize_handle(row.get("ig")):
            clubs[handle].append(
                {
                    "id": int(row["id"]),
                    "club_name": row.get("club_name"),
                    "logo_url": row.get("logo_url"),
                }
            )
    return clubs


def _load(path: Path) -> dict[str, float]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}
