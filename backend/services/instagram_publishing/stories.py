"""Stories for published carousels, shared on the Mac from the Instagram app.

After a carousel publishes, the emulator worker visits its school's account and
``share_due`` shares each of its events' original posts to the account's story, in
slide order, the way a person adds someone else's post to their story: the story
shows the club's post and opens it when tapped. A post that cannot be shared (the
club turned resharing off, or the post is gone) is left out and the rest go on.

Each post is tried once and a carousel's story is never shared again, since a share
that seemed to fail may already be on the story.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.constants import INSTAGRAM_BATCH_PUBLISHED
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INSTAGRAM_PUBLISH_BATCHES, INSTAGRAM_PUBLISH_ITEMS
from services import school_service
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.story import share_to_story

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
EMULATOR = controlbox.instagram_emulator
STORY_PENDING = "pending"
STORY_POSTED = "posted"
STORY_FAILED = "failed"
# The blue "Featured" sticker on each story, in the school's language; drawn like the
# slides' stickers by frontend/scripts/render-featured-story-sticker.mjs.
_FEATURED_STICKERS = {
    language: Path(__file__).parents[1]
    / "instagram_emulator"
    / "assets"
    / f"featured_sticker_{language}.png"
    for language in ("en", "fr")
}
_POST_URL = re.compile(
    r"^https://(?:www\.)?instagram\.com/(?P<kind>p|reel)/(?P<code>[A-Za-z0-9_-]+)"
)


def schools_due(now: datetime | None = None) -> list[str]:
    """Schools with a published carousel whose story waits, longest waiting first."""
    schools = [batch["school"] for batch in _pending_batches(now or datetime.now(timezone.utc))]
    return list(dict.fromkeys(schools))


def share_due(device: EmulatorDevice, school: str, now: datetime | None = None) -> None:
    """Share the original posts of each of the school's carousels whose story waits.

    The worker calls this with the app already on the school's account. Like a DM's
    story repost, it waits while the emulator is short of free storage.
    """
    if device.free_data_megabytes() < EMULATOR.min_free_data_megabytes:
        log.warning("Carousel stories for %s wait for free storage on the emulator", school)
        return
    for batch in _pending_batches(now or datetime.now(timezone.utc)):
        if batch["school"] == school:
            _share(device, school, batch["id"])


def _pending_batches(now: datetime) -> list[dict[str, Any]]:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select(f"id,published_at,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("status", INSTAGRAM_BATCH_PUBLISHED)
        .eq("story_status", STORY_PENDING)
        .gte("published_at", (now - timedelta(hours=_CONTROL.story_max_age_hours)).isoformat())
        .order("published_at")
        .execute()
    )
    return [school_service.with_school_slug(row) for row in response.data or []]


def _share(device: EmulatorDevice, school: str, batch_id: str) -> None:
    urls = original_posts(batch_id)
    record = school_service.get_school(school)
    sticker = _FEATURED_STICKERS[record.language if record else "en"]
    # Recorded before the first share, so a worker stopped halfway never shares twice.
    _record(batch_id, STORY_FAILED, "Stopped while sharing")
    shared = 0
    for url in urls:
        try:
            share_to_story(device, school, url, sticker=sticker)
            shared += 1
        except EmulatorError:
            log.warning("Could not share %s to %s's story", url, school, exc_info=True)
            device.reset_app(EMULATOR.android_user_by_school[school])
    status = STORY_POSTED if shared else STORY_FAILED
    error = None if shared == len(urls) else f"{shared} of {len(urls)} posts shared"
    _record(batch_id, status, error)


def original_posts(batch_id: str) -> list[str]:
    """Each event slide's original Instagram post, in slide order, as the exact link the
    app opens; events with no post (from a school directory, say) are left out."""
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("position,event:events(source_url)")
        .eq("batch_id", str(batch_id))
        .order("position")
        .execute()
    ).data or []
    urls = []
    for row in rows:
        match = _POST_URL.match((row.get("event") or {}).get("source_url") or "")
        if match:
            url = f"https://www.instagram.com/{match['kind']}/{match['code']}/"
            if url not in urls:
                urls.append(url)
    return urls


def _record(batch_id: str, status: str, error: str | None) -> None:
    # `updated_at` stays: the song's retries are timed from it.
    get_sb().table(INSTAGRAM_PUBLISH_BATCHES).update(
        {"story_status": status, "story_error": error}
    ).eq("id", batch_id).execute()
