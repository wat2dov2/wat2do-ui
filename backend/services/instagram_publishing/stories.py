"""Stories for posted carousels, shared on the Mac from the Instagram app.

Right after a sitting posts a carousel and sets its song, its ``ig stories`` move
(``services/instagram_sessions/moves.py``) calls ``share``: each of the carousel's
events' original posts goes to the account's story, in slide order, the way a person
adds someone else's post to their story: the story shows the club's post and opens it
when tapped. A post that cannot be shared (the club turned resharing off, or the post
is gone) is left out and the rest go on.

Each post is tried once and a carousel's story is never shared again, since a share
that seemed to fail may already be on the story. Why each post was not shared goes into
``story_error`` and the move's answer, which the sitting's log keeps.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INSTAGRAM_PUBLISH_BATCHES, INSTAGRAM_PUBLISH_ITEMS
from services import school_service
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.story import share_to_story

log = logging.getLogger(__name__)

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


@dataclass(frozen=True)
class Story:
    """How a carousel's story went: how many of its posts were shared, and why each
    post that was not shared failed, by its link."""

    shared: int
    total: int
    failed: dict[str, str]

    @property
    def error(self) -> str | None:
        """What ``story_error`` records: the count, then each failed post's reason."""
        if not self.failed:
            return None
        reasons = "; ".join(f"{url} {reason}" for url, reason in self.failed.items())
        return f"{self.shared} of {self.total} posts shared. Not shared: {reasons}"


def share(device: EmulatorDevice, school: str, batch_id: str) -> Story:
    """Share the carousel's events' original posts to the story.

    The sitting holds the emulator on the school's account. Like a DM's story share,
    it waits while the emulator is short of free storage.
    """
    if device.free_data_megabytes() < EMULATOR.min_free_data_megabytes:
        raise EmulatorError("The emulator is low on storage; the story waits")
    urls = original_posts(batch_id)
    record = school_service.get_school(school)
    sticker = _FEATURED_STICKERS[record.language if record else "en"]
    # Recorded before the first share, so a worker stopped halfway never shares twice.
    _record(batch_id, STORY_FAILED, "Stopped while sharing")
    failed = {}
    for url in urls:
        try:
            share_to_story(device, school, url, sticker=sticker)
        except EmulatorError as exc:
            log.warning("Could not share %s to %s's story", url, school, exc_info=True)
            failed[url] = str(exc)
            device.reset_app(EMULATOR.android_user_by_school[school])
    story = Story(shared=len(urls) - len(failed), total=len(urls), failed=failed)
    _record(batch_id, STORY_POSTED if story.shared else STORY_FAILED, story.error)
    return story


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
