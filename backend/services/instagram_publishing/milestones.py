"""Thank-you stories at a school account's milestones, posted on the Mac from the app.

Two milestones, each celebrated once:

- the newest clean hundred followers (100, 200, 300...) the account just reached, with a
  screenshot of its own profile;
- a post of ours that just beat the account's record for likes, with a screenshot of
  that post.

Follower counts and like counts come from the daily Instagram stats run
(``wat2do-instagram stats``: ``instagram_account_snapshots`` and the newest posts in
``instagram_account_media``). ``instagram_account_milestones`` keeps where each account
stood at its last check and which milestones it celebrated.

A sitting decides and code guards (Tony, 2026-11-25). Its ``ig milestones`` move
(``report``) shows Claude the account's follower history, its like record and what was
already celebrated, records this check, and opens the milestones the guards allow: only
a crossing this check sees happen since the last one, a day or less ago. An account's
first check only records where it stands, a jump over several hundreds opens only the
newest, a hundred at or under the highest celebrated never opens again (a dip and
recovery), and a crossing found late is only recorded. Claude looks at the history and
posts the story with ``ig milestone-story`` (``post_story``), which takes only an open
milestone, in the same sitting, and closes it just before "Your story" is tapped, so
no milestone is ever posted twice.
"""

from __future__ import annotations

import io
import logging
import random
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageDraw, ImageFont, ImageOps

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import (
    INSTAGRAM_ACCOUNT_MEDIA,
    INSTAGRAM_ACCOUNT_MILESTONES,
    INSTAGRAM_ACCOUNT_SNAPSHOTS,
    INSTAGRAM_PUBLISHING_ACCOUNTS,
)
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.story import post_screenshot, profile_screenshot, share_photo

log = logging.getLogger(__name__)

EMULATOR = controlbox.instagram_emulator
CONTROL = controlbox.instagram_sessions
FOLLOWER_STEP = 100
# The follower history a sitting is shown, in daily stats runs.
HISTORY_DAYS = 14
# Plain student voice, lowercase, no emoji and no em dash; one is picked at random.
THANKS: dict[str, dict[str, tuple[str, ...]]] = {
    "followers": {
        "en": (
            "we just hit {count} followers. thank you all for being here",
            "{count} followers!! thank you so much for following along",
            "we're at {count} followers now. thanks for being here everyone",
        ),
        "fr": (
            "on vient d'atteindre {count} abonnés. merci à vous tous d'être là",
            "{count} abonnés!! merci énormément de nous suivre",
            "on est rendus à {count} abonnés. merci d'être là tout le monde",
        ),
    },
    "likes": {
        "en": (
            "our most liked post ever. thank you",
            "this is officially our most liked post ever. thank you all",
            "new record for our most liked post. thank you everyone",
        ),
        "fr": (
            "notre publication la plus aimée à date. merci",
            "c'est officiellement notre publication la plus aimée. merci à vous tous",
            "nouveau record pour notre publication la plus aimée. merci tout le monde",
        ),
    },
}

# The story card: Wat2Do's blue, the thanks in white Satoshi above the screenshot.
_CARD_SIZE = (1080, 1920)
_CARD_BLUE = (0, 82, 255)
_TEXT_WHITE = (255, 255, 255)
_FONT = Path(__file__).parents[3] / "frontend/public/fonts/slides/Satoshi-700.ttf"
_FONT_SIZE = 58
_LINE_SPACING = 12
_MARGIN = 80
_TEXT_TOP = 200
_SHOT_GAP = 70
_SHOT_BOTTOM = 190
_SHOT_RADIUS = 32


class MilestoneError(RuntimeError):
    """The milestone story is refused; the message says why."""


@dataclass(frozen=True)
class Post:
    media_id: str
    permalink: str
    likes: int


@dataclass(frozen=True)
class Reading:
    """What the newest stats run read: followers, the newest posts (newest first) and
    when."""

    followers: int
    posts: tuple[Post, ...]
    captured_at: datetime


@dataclass(frozen=True)
class Standing:
    """Where an account stood at its last check: the highest hundred followers it
    celebrated, the follower count it had, the most likes any of its posts had and which
    post, every post whose record got a story (or stood at the first check), when it was
    checked, and the milestones that check opened for a story."""

    followers: int
    followers_seen: int
    like_record: int
    record_media_id: str | None
    celebrated: frozenset[str]
    checked_at: datetime
    open_followers: int | None = None
    open_media_id: str | None = None


@dataclass(frozen=True)
class Milestone:
    kind: Literal["followers", "likes"]
    count: int
    post: Post | None = None


def seed(reading: Reading, now: datetime) -> Standing:
    """An account's first check opens nothing: what it has counts as celebrated."""
    best = _best(reading.posts)
    return Standing(
        followers=reading.followers // FOLLOWER_STEP * FOLLOWER_STEP,
        followers_seen=reading.followers,
        like_record=best.likes if best else 0,
        record_media_id=best.media_id if best else None,
        celebrated=frozenset({best.media_id}) if best else frozenset(),
        checked_at=now,
    )


def check(standing: Standing, reading: Reading, now: datetime) -> tuple[list[Milestone], Standing]:
    """The milestones the account just reached, and where it stands now with them open.

    A milestone counts only when this check sees it happen since the last one: the
    follower count went from under a hundred to at or over it (only the newest hundred
    when it jumped over several, and never one at or under the highest already
    celebrated, so a dip and recovery never repeats one), or a post beat the like
    record. When the last check is over ``milestone_window_hours`` old, the crossing may
    be days old, so the new numbers are only recorded; a stats run that old is no new
    reading at all. A like record under ``milestone_minimum_likes``, or held by a post
    whose record already had its story, is recorded without one.
    """
    window = timedelta(hours=CONTROL.milestone_window_hours)
    if now - reading.captured_at > window:
        # The stats run stopped (an account's token broke): nothing new to compare, and
        # the check stays as old as the numbers it saw.
        return [], replace(standing, open_followers=None, open_media_id=None)
    recent = now - standing.checked_at <= window
    milestones = []
    hundred = reading.followers // FOLLOWER_STEP * FOLLOWER_STEP
    if recent and standing.followers_seen < hundred and hundred > standing.followers:
        milestones.append(Milestone("followers", hundred))
    best = _best(reading.posts)
    beaten = best is not None and best.likes > standing.like_record
    if (
        recent
        and best is not None
        and beaten
        and best.media_id not in standing.celebrated
        and best.likes >= CONTROL.milestone_minimum_likes
    ):
        milestones.append(Milestone("likes", best.likes, best))
    return milestones, replace(
        standing,
        followers_seen=reading.followers,
        like_record=best.likes if best is not None and beaten else standing.like_record,
        record_media_id=best.media_id if best is not None and beaten else standing.record_media_id,
        checked_at=now,
        open_followers=next((m.count for m in milestones if m.kind == "followers"), None),
        open_media_id=next((m.post.media_id for m in milestones if m.post), None),
    )


def celebrated(standing: Standing, milestone: Milestone) -> Standing:
    """The standing once ``milestone`` is on the story: celebrated and no longer open."""
    if milestone.kind == "followers":
        return replace(
            standing, followers=max(standing.followers, milestone.count), open_followers=None
        )
    assert milestone.post is not None
    return replace(
        standing, celebrated=standing.celebrated | {milestone.post.media_id}, open_media_id=None
    )


def opened(standing: Standing, reading: Reading, now: datetime, milestone: Milestone) -> Milestone:
    """``milestone`` as it may be posted now, or raise why it may not: it must be open,
    from a check of this sitting (at most ``sitting_timeout_minutes`` ago)."""
    if now - standing.checked_at > timedelta(minutes=CONTROL.sitting_timeout_minutes):
        raise MilestoneError(
            "Run ig milestones first: only a milestone it just opened can be posted"
        )
    if milestone.kind == "followers":
        if milestone.count != standing.open_followers:
            raise MilestoneError(
                f"{milestone.count} followers is not open: only a hundred the account just "
                "reached, above every hundred already celebrated, can get a story"
            )
        return milestone
    post = next((post for post in reading.posts if post.media_id == standing.open_media_id), None)
    if milestone.post is None or post is None or post.permalink != milestone.post.permalink:
        raise MilestoneError(
            "That post is not open: only a post that just beat the like record, and never "
            "had its story, can get one"
        )
    return Milestone("likes", post.likes, post)


def thanks(milestone: Milestone, language: str, rng: random.Random | None = None) -> str:
    lines = THANKS[milestone.kind]["fr" if language == "fr" else "en"]
    return (rng or random.SystemRandom()).choice(lines).format(count=milestone.count)


def report(school_id: int, now: datetime | None = None) -> dict[str, Any]:
    """Check the account and say what a sitting needs to decide on a milestone story:
    the follower history, the like record, what was celebrated and what is open."""
    moment = now or datetime.now(timezone.utc)
    account = _account_key(school_id)
    reading = _reading(account) if account else None
    if account is None or reading is None:
        return {"status": "this account has no Instagram stats yet", "open": []}
    standing = _standing(account)
    if standing is None:
        standing, milestones, first = seed(reading, moment), [], True
        _save(account, standing, new=True)
    else:
        milestones, standing = check(standing, reading, moment)
        first = False
        _save(account, standing)
    best = _best(reading.posts)
    return {
        "first_check": first,
        "followers_history": _history(account),
        "followers_now": reading.followers,
        "stats_read_at": reading.captured_at.isoformat(),
        "highest_followers_celebrated": standing.followers,
        "like_record": standing.like_record,
        "most_liked_recent_post": (
            {"post": best.permalink, "likes": best.likes} if best is not None else None
        ),
        "open": [
            {"followers": m.count}
            if m.post is None
            else {"likes": m.count, "post": m.post.permalink}
            for m in milestones
        ],
    }


def post_story(
    device: EmulatorDevice,
    *,
    school_id: int,
    user: int,
    username: str,
    language: str,
    milestone: Milestone,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Post the thank-you story for an open milestone, or raise why it may not.

    The emulator is held on ``username``'s account, on Android user ``user``. The
    milestone counts as celebrated, and is closed, just before "Your story" is tapped:
    a story that fails before then can be tried again in the same sitting, and one that
    may be on the story is never posted again.
    """
    moment = now or datetime.now(timezone.utc)
    account = _account_key(school_id)
    reading = _reading(account) if account else None
    standing = _standing(account) if account else None
    if account is None or reading is None or standing is None:
        raise MilestoneError("Run ig milestones first: this account has no milestone check")
    milestone = opened(standing, reading, moment, milestone)
    if device.free_data_megabytes() < EMULATOR.min_free_data_megabytes:
        raise MilestoneError("The emulator is low on storage; no story this time")
    if milestone.post is None:
        shot = profile_screenshot(device, user, username)
    else:
        shot = post_screenshot(device, user, milestone.post.permalink)
    card = story_card(shot, thanks(milestone, language))

    def record() -> None:
        # Read again: the sitting's other milestone may have been recorded since.
        current = _standing(account)
        assert current is not None
        _save(account, celebrated(current, milestone))

    try:
        share_photo(device, user, card, before_post=record)
    except EmulatorError:
        device.reset_app(user)
        raise
    return {"milestone": milestone.kind, "count": milestone.count, "status": "posted to the story"}


def story_card(screenshot: bytes, text: str) -> bytes:
    """A 1080x1920 story: ``text`` in white on Wat2Do blue above the screenshot, which
    is scaled to fit below it with rounded corners. PNG bytes."""
    card = Image.new("RGB", _CARD_SIZE, _CARD_BLUE)
    draw = ImageDraw.Draw(card)
    font = ImageFont.truetype(str(_FONT), _FONT_SIZE)
    lines = _wrap(text, font, _CARD_SIZE[0] - 2 * _MARGIN)
    top = _TEXT_TOP
    for line in lines:
        width = draw.textlength(line, font=font)
        draw.text(((_CARD_SIZE[0] - width) / 2, top), line, font=font, fill=_TEXT_WHITE)
        top += _FONT_SIZE + _LINE_SPACING
    with Image.open(io.BytesIO(screenshot)) as image:
        shot = image.convert("RGB")
    box = (_CARD_SIZE[0] - 2 * _MARGIN, _CARD_SIZE[1] - _SHOT_BOTTOM - top - _SHOT_GAP)
    shot = ImageOps.contain(shot, box, Image.Resampling.LANCZOS)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *shot.size), _SHOT_RADIUS, fill=255)
    card.paste(shot, ((_CARD_SIZE[0] - shot.width) // 2, top + _SHOT_GAP), mask)
    out = io.BytesIO()
    card.save(out, format="PNG")
    return out.getvalue()


def _wrap(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and font.getlength(f"{lines[-1]} {word}") <= width:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return lines


def _best(posts: Sequence[Post]) -> Post | None:
    """The post with the most likes; the newest one on a tie (posts come newest first)."""
    return max(posts, key=lambda post: post.likes, default=None)


# --- the database -------------------------------------------------------------------


def _account_key(school_id: int) -> str | None:
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select("account_key")
        .eq("school_id", school_id)
        .limit(1)
        .execute()
    ).data or []
    return rows[0]["account_key"] if rows else None


def _reading(account: str) -> Reading | None:
    """The newest stats run's follower count and posts, or None before the first run."""
    snapshots = (
        get_sb()
        .table(INSTAGRAM_ACCOUNT_SNAPSHOTS)
        .select("followers_count,captured_at")
        .eq("account_key", account)
        .order("captured_on", desc=True)
        .limit(1)
        .execute()
    ).data or []
    if not snapshots:
        return None
    media = (
        get_sb()
        .table(INSTAGRAM_ACCOUNT_MEDIA)
        .select("media_id,permalink,like_count")
        .eq("account_key", account)
        .order("posted_at", desc=True)
        .execute()
    ).data or []
    return Reading(
        followers=int(snapshots[0]["followers_count"]),
        posts=tuple(
            Post(media_id=row["media_id"], permalink=row["permalink"], likes=int(row["like_count"]))
            for row in media
            if row.get("like_count") is not None
        ),
        captured_at=datetime.fromisoformat(snapshots[0]["captured_at"]),
    )


def _history(account: str) -> list[dict[str, Any]]:
    """The follower count of each of the last ``HISTORY_DAYS`` stats runs, oldest first."""
    rows = (
        get_sb()
        .table(INSTAGRAM_ACCOUNT_SNAPSHOTS)
        .select("captured_on,followers_count")
        .eq("account_key", account)
        .order("captured_on", desc=True)
        .limit(HISTORY_DAYS)
        .execute()
    ).data or []
    return [
        {"day": row["captured_on"], "followers": row["followers_count"]} for row in reversed(rows)
    ]


def _standing(account: str) -> Standing | None:
    rows = (
        get_sb()
        .table(INSTAGRAM_ACCOUNT_MILESTONES)
        .select(
            "followers_celebrated,followers_seen,like_record,like_record_media_id,"
            "celebrated_media_ids,checked_at,open_followers,open_media_id"
        )
        .eq("account_key", account)
        .execute()
    ).data or []
    if not rows:
        return None
    row = rows[0]
    return Standing(
        followers=int(row["followers_celebrated"]),
        followers_seen=int(row["followers_seen"]),
        like_record=int(row["like_record"]),
        record_media_id=row.get("like_record_media_id"),
        celebrated=frozenset(row.get("celebrated_media_ids") or ()),
        checked_at=datetime.fromisoformat(row["checked_at"]),
        open_followers=row.get("open_followers"),
        open_media_id=row.get("open_media_id"),
    )


def _save(account: str, standing: Standing, *, new: bool = False) -> None:
    row = {
        "followers_celebrated": standing.followers,
        "followers_seen": standing.followers_seen,
        "like_record": standing.like_record,
        "like_record_media_id": standing.record_media_id,
        "celebrated_media_ids": sorted(standing.celebrated),
        "checked_at": standing.checked_at.isoformat(),
        "open_followers": standing.open_followers,
        "open_media_id": standing.open_media_id,
    }
    table = get_sb().table(INSTAGRAM_ACCOUNT_MILESTONES)
    if new:
        table.insert({"account_key": account, **row}).execute()
    else:
        table.update(row).eq("account_key", account).execute()
