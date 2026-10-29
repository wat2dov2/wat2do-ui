"""Club logos from the Instagram profiles Brave already knows how to read.

A profile retrieval asks Instagram's own web endpoint for the profile, and that
response carries the profile picture. Clubs with an Instagram handle and no logo
are queued a few at a time every few minutes and capped per day, behind digests
and engagement, so the logged-in accounts read profiles at a person's pace. Any profile
retrieval, including a manual one, fills in a matching club's missing logo.
Instagram's picture links expire, so each one is copied to S3 right away.
"""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from datetime import date
from typing import Any
from urllib.parse import urlsplit

from core.constants import BUCKET_CLUB_LOGOS
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import CLUBS, SCHOOLS
from schemas.club import ClubUpdate
from services import club_service
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import school_account_username
from services.scraper.image_uploader import upload_image_from_url

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_browser
_HANDLE = re.compile(r"[a-z0-9._]{1,30}")
_JOBS_SETTING = "club_logo_jobs"
_DAY_SETTING = "club_logo_day"
_CHECKED_SETTING = "club_logo_checked_at"


def instagram_handle(value: object) -> str | None:
    """A club's ``ig`` as a bare lowercase username, or None when it is not one."""
    text = str(value or "").strip()
    if text.startswith(("http://", "https://")):
        parsed = urlsplit(text)
        if (parsed.hostname or "").lower().removeprefix("www.") != "instagram.com":
            return None
        text = parsed.path.strip("/").split("/", 1)[0]
    handle = text.lstrip("@").casefold()
    return handle if _HANDLE.fullmatch(handle) else None


def sync_club_logos(queue: BrowserJobQueue) -> dict[str, int]:
    """Store the pictures retrievals found, then queue the next few profiles."""
    now = time.time()
    if now - float(queue.get_setting(_CHECKED_SETTING, 0)) < _CONTROL.club_logo_interval_seconds:
        return {"stored": 0, "queued": 0}
    queue.set_setting(_CHECKED_SETTING, now)
    clubs = _clubs_without_logos()
    stats = {"stored": _store_retrieved_logos(queue, clubs), "queued": 0}
    stats["queued"] = _queue_profiles(queue, clubs)
    return stats


def _clubs_without_logos() -> dict[str, list[dict[str, Any]]]:
    """Logo-less clubs by Instagram handle, with the school that can read them."""
    sb = get_sb()
    schools = {
        str(row["id"]): row
        for row in sb.table(SCHOOLS).select("id,slug,recipient_id").execute().data or []
    }
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                sb.table(CLUBS)
                .select("id,ig,school_id")
                .is_("logo_url", "null")
                .not_.is_("ig", "null")
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )
    clubs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        handle = instagram_handle(row.get("ig"))
        school = schools.get(str(row.get("school_id")))
        if handle and school and school.get("recipient_id"):
            clubs[handle].append({"id": row["id"], "school": school})
    return clubs


def _store_retrieved_logos(queue: BrowserJobQueue, clubs: dict[str, list[dict[str, Any]]]) -> int:
    stored = 0
    for job in queue.retrieval_results():
        key = f"club_logo_stored:{job.id}"
        if queue.get_setting(key):
            continue
        result = job.result or {}
        handle = instagram_handle(result.get("target_url"))
        picture = result.get("profile_picture_url")
        waiting = clubs.get(handle or "", [])
        if picture and waiting:
            logo_url = upload_image_from_url(str(picture), bucket=BUCKET_CLUB_LOGOS)
            if logo_url is None:
                log.warning("Club logo for a retrieved profile could not be stored")
            for club in waiting if logo_url else []:
                if club_service.update_club(int(club["id"]), ClubUpdate(logo_url=logo_url)):
                    stored += 1
        queue.set_setting(key, True)
    return stored


def _queue_profiles(queue: BrowserJobQueue, clubs: dict[str, list[dict[str, Any]]]) -> int:
    outstanding = [
        job_id
        for job_id in queue.get_setting(_JOBS_SETTING, [])
        if (job := queue.get(job_id)) is not None and job.state in {"pending", "running"}
    ]
    today = date.today().isoformat()
    day = queue.get_setting(_DAY_SETTING) or {}
    used = int(day.get("count", 0)) if day.get("date") == today else 0
    room = min(
        _CONTROL.club_logo_pending_limit - len(outstanding),
        _CONTROL.club_logo_daily_limit - used,
    )
    queued = 0
    retry_after = time.time() - _CONTROL.club_logo_retry_days * 86400
    for handle, waiting in clubs.items():
        if queued >= room:
            break
        attempted = queue.get_setting(f"club_logo_attempted:{handle}")
        if attempted is not None and float(attempted) > retry_after:
            continue
        school = waiting[0]["school"]
        account = school_account_username(str(school["slug"]))
        if queue.account_excluded(account):
            continue
        try:
            job_id = queue.enqueue_retrieval(
                school=str(school["slug"]),
                recipient_id=str(school["recipient_id"]),
                account_username=account,
                url=f"https://www.instagram.com/{handle}/",
            )
        except ValueError:
            continue
        queue.set_setting(f"club_logo_attempted:{handle}", time.time())
        outstanding.append(job_id)
        queued += 1
    queue.set_setting(_JOBS_SETTING, outstanding)
    queue.set_setting(_DAY_SETTING, {"date": today, "count": used + queued})
    return queued
