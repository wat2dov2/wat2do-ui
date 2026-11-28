"""`ig`: the moves a Claude sitting makes on the emulator, one command per move.

A sitting (``sitting.py``) runs Claude Code with only this command on its PATH. Every
move works on the sitting's own school account (``WAT2DO_SITTING_SCHOOL``), on the
emulator the worker already holds for it (``WAT2DO_EMULATOR_HELD``), and prints one
JSON object. Each move appends when it started and ended and how it went to the day's
sitting log, never a message's text.

The notification agent (``notification.py``) uses the same command for one DM, mention
or comment at a time: its moves reply, react with a heart, boost a shared post, accept a
request, mute an account that asked to be left out, and send the claim-link message
(``ig claim``) to a club that asked us to repost or feature its post (Tony, 2026-11-24),
at most once to each club. Every move that others can see waits a random pause first,
stays within its daily cap per account, works only in the thread it names, refuses a
thread whose sender asked to be left out, and stops at any challenge Instagram shows,
which pauses the account (``notification.pause``). With ``WAT2DO_NOTIFICATION_DRY_RUN``
set, the moves read a recorded thread instead and only say what they would do
(``_dry_run``).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import subprocess
import sys
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from core.constants import INSTAGRAM_BATCH_PUBLISHED, INSTAGRAM_MUSIC_PENDING
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import (
    CLUB_MEMBERS,
    CLUBS,
    EVENTS,
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
    OUTREACH_LEADS,
)
from schemas.event_date import OccurrenceUpdate
from services import event_date_service, event_service, school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.ingestion import items
from services.instagram_accounts import android_user, school_account_username
from services.instagram_emulator.audio import like_and_repost
from services.instagram_emulator.comments import (
    PinLimitReached,
    like_comment,
    pin_comment,
    read_comments,
)
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, exclusive
from services.instagram_emulator.direct import (
    CLAIM_LINK,
    LeftOut,
    ThreadReader,
    asks_to_be_left_out,
    dms_refused,
    exclude_club,
    plain_handle,
    refuse_dms,
    refuse_if_excluded,
)
from services.instagram_emulator.following import FollowingReader
from services.instagram_emulator.inbox import open_row, read_inbox
from services.instagram_emulator.story import share_to_story
from services.instagram_publishing import milestones, music, stories
from services.instagram_sessions import notification

EMULATOR = controlbox.instagram_emulator
DMS = controlbox.instagram_dms
PUBLISHING = controlbox.instagram_publishing
TORONTO = ZoneInfo("America/Toronto")
LOG_DIR = Path.home() / ".local/state/wat2do/instagram-sittings"
BACKEND_DIR = Path(__file__).resolve().parents[2]
CARGO = Path.home() / ".cargo/bin/cargo"
# A post waits for a curation run holding the carousel lock (up to its 30 minute timeout).
POST_TIMEOUT_SECONDS = 2700

CLAIM_MESSAGE = {
    "en": (
        "Hey! We're happy to keep featuring your events. One small favour: could you claim "
        "your club on Wat2Do? It adds a verified check to your page and events and really "
        "helps us build credibility with students. Here's your club's link: {link} Thank you!"
    ),
    "fr": (
        "Salut ! On continue avec plaisir a partager vos evenements. Petite faveur : "
        "pourriez-vous reclamer votre club sur Wat2Do ? Ca ajoute un crochet verifie a votre "
        "page et a vos evenements, et ca nous aide vraiment a gagner la confiance des "
        "etudiants. Voici le lien de votre club : {link} Merci !"
    ),
}

_ADDRESS = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}\S*", re.IGNORECASE)
_OUR_ADDRESS = re.compile(r"^(?:https?://)?(?:[a-z0-9-]+\.)?wat2do\.io(?:/\S*)?$", re.IGNORECASE)
# A long number may be a code or a phone number a message tried to smuggle out.
_DIGITS = re.compile(r"\d{5,}")
# Anything that sends a message or a post to someone: only a move's own code taps it.
_SENDS = re.compile(r"^(?:send|send post|send separately|send to)$", re.IGNORECASE)
_PLAIN_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
# Moves that act on the account, refused while its notification handling is paused.
_ACTING = frozenset(
    {
        "reply",
        "heart",
        "boost",
        "accept",
        "mute",
        "claim",
        "share",
        "feature",
        "correction",
        "opt-out",
        "milestone-story",
        "fix-event",
        "like-comment",
        "pin-comment",
    }
)
# Moves that send a DM, refused outright on a French-language school's account.
_MESSAGING = frozenset({"reply", "claim"})
# Moves that only read what is on the device, or never touch it.
_READING = frozenset({"status", "inbox", "read", "screen", "shot", "milestones", "comments"})
# How many of the account's newest posts ``ig comments`` reads.
_COMMENTED_POSTS = 3
# How far back the daily caps and the per-thread repeats look.
_LOG_DAYS = 2


class MoveError(RuntimeError):
    """The move refused or failed; its message is printed for Claude to read."""


@dataclass(frozen=True)
class ClaimTarget:
    """An unclaimed club of this school that may get its claim link."""

    club_id: int
    name: str
    handle: str
    # The claim token its link carries.
    token: str
    # Every claim token of its outreach leads: a draft typed earlier may carry any of them.
    tokens: frozenset[str]


def school() -> str:
    return os.environ["WAT2DO_SITTING_SCHOOL"]


def user() -> int:
    return android_user(school())


# --- the carousel ------------------------------------------------------------------


def status(_device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Today's draft and the carousel waiting for its follow-up, if any."""
    record = school_service.get_school(school())
    draft = _todays_draft()
    waiting = _waiting_carousel()
    return {
        "school": school(),
        "school_name": record.name if record else school(),
        "account": school_account_username(school()),
        "todays_draft": draft,
        "posted_carousel_waiting": waiting,
        "minimum_slides": PUBLISHING.minimum_event_slides,
    }


def post(_device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Post today's draft through Instagram's API (`wat2do-instagram publish-draft`)."""
    # Run the way the carousel LaunchAgents run it: from the backend, for its .env.
    result = subprocess.run(
        [str(CARGO), "run", "--release", "--quiet"]
        + ["--manifest-path", str(BACKEND_DIR.parent / "rust/Cargo.toml")]
        + ["--bin", "wat2do-instagram", "--", "publish-draft", school()],
        cwd=BACKEND_DIR,
        env={**os.environ, "PATH": f"{CARGO.parent}{os.pathsep}{os.environ.get('PATH', '')}"},
        capture_output=True,
        text=True,
        timeout=POST_TIMEOUT_SECONDS,
    )
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if result.returncode or not lines:
        raise MoveError(f"publish-draft failed (exit {result.returncode})")
    return json.loads(lines[-1])


def finish(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Like, repost, GIF comment, place, club tags and song on the posted carousel."""
    batch = _waiting_carousel()
    if batch is None:
        raise MoveError("No posted carousel of this school is waiting for its song")
    outcome = music.finish(device, {**batch, "school": school()})
    row = _batch(batch["id"])
    return {"status": outcome, "track": row.get("music_track"), "error": row.get("music_error")}


def share_stories(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Share each event's original post to the story, once per carousel."""
    batch = _story_carousel()
    if batch is None:
        raise MoveError("No posted carousel of this school is waiting for its story")
    story = stories.share(device, school(), batch["id"])
    return {"shared": story.shared, "of": story.total, "not_shared": story.failed}


def milestone_report(_device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """The account's follower history, like record and celebrated milestones, and the
    milestones this check opened for a thank-you story."""
    return milestones.report(_school_id())


def milestone_story(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Post the thank-you story for an open milestone: a hundred followers, or a post's
    like record."""
    # Tony 2026-11-28: no milestone or like-record stories, ever.
    raise MoveError("Milestone stories are turned off")
    record = school_service.get_school(school())
    if record is None:
        raise MoveError("This school is not in the database")
    if args.followers is not None:
        wanted = milestones.Milestone("followers", args.followers)
    else:
        wanted = milestones.Milestone("likes", 0, milestones.Post("", args.likes, 0))
    try:
        return milestones.post_story(
            device,
            school_id=record.id,
            user=user(),
            username=school_account_username(school()),
            language=record.language,
            milestone=wanted,
        )
    except milestones.MilestoneError as exc:
        raise MoveError(str(exc)) from exc


# --- direct messages ---------------------------------------------------------------


def inbox(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Every listed thread once; a message request's own row wins."""
    rows = {row.name: row for row in read_inbox(device, user(), requests=False)}
    rows.update({row.name: row for row in read_inbox(device, user(), requests=True)})
    handled = _requests_handled()
    claimed = {entry.get("thread") for entry in _logged(("claim",))}
    messaging = not dms_refused(school())
    return {
        "threads": [
            {
                "name": row.name,
                "preview": _without_claim_links(row.preview),
                "age_days": row.age_days,
                "unread": row.unread,
                "request": row.request,
                "ours_last": row.ours,
                # A claim follows up a request we handled a day ago, once nothing is new.
                "claim_due": messaging
                and row.ours
                and row.name not in claimed
                and _follow_up_due(handled.get(row.name)),
            }
            for row in rows.values()
        ]
    }


def read(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    reader = _reader(device, args.thread)
    messages = [
        {**message, "text": _without_claim_links(message["text"])} for message in reader.read()
    ]
    # Whether its newest dated message is over a week old, known once it is read.
    return {"thread": args.thread, "stale": reader.stale, "messages": messages}


def claim(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Send the club behind ``username`` its claim-link message in the thread.

    The one DM a sitting sends, at most once to each club, and only in the club's own
    thread (``ThreadReader.send_claim`` checks the thread before touching it). It only
    follows up: at least ``claim_follow_up_hours`` after we shared or featured the post
    the thread asked for, with our message still the newest there, never alongside that
    reply (Tony, 2026-11-25). A claim-link draft already waiting there is sent as it is
    when it carries the club's own link. Each account sends at most
    ``claim_sends_per_account_per_day`` a day, each a random ``claim_send_gap_*_seconds``
    after its last, so it never sends in a burst.
    """
    if DMS.claim_sends_per_account_per_day == 0:
        raise MoveError("Claim messages are switched off; send nothing")
    if not _follow_up_due(_requests_handled().get(args.thread)):
        raise MoveError(
            "Not due: a claim only follows up a day after we shared or featured a post "
            "this thread asked for"
        )
    target = claim_target(args.username)
    sent_today = _claims_sent_today()
    if len(sent_today) >= DMS.claim_sends_per_account_per_day:
        raise MoveError("This account sent its claim messages for today; try again tomorrow")
    if sent_today:
        gap = random.uniform(DMS.claim_send_gap_min_seconds, DMS.claim_send_gap_max_seconds)
        wait = gap - (datetime.now(timezone.utc) - max(sent_today)).total_seconds()
        if wait > 0:
            time.sleep(wait)
    outcome = _reader(device, args.thread).send_claim(
        _claim_message(target.token), handle=target.handle, tokens=target.tokens
    )
    return {
        "thread": args.thread,
        "claim_for": target.name,
        "club_id": target.club_id,
        "status": outcome,
    }


def _claim_message(token: str) -> str:
    record = school_service.get_school(school())
    language = "fr" if record and record.language == "fr" else "en"
    link = f"https://{school()}.wat2do.io/claim/{token}"
    return plain(CLAIM_MESSAGE[language].format(link=link))


def _claims_sent_today() -> list[datetime]:
    """When this account's claim messages went out today, from the sitting log."""
    return [
        datetime.fromisoformat(entry["ended"])
        for entry in _logged(("claim",), [LOG_DIR / f"{_today()}.jsonl"])
    ]


def _claimed_before(club_id: int, name: str) -> bool:
    """Whether this account ever sent the club its claim message, from every sitting log.
    Logs from before 2026-11-25 name the club only (``claim_for``)."""
    return any(
        entry["result"].get("club_id") == club_id or entry["result"].get("claim_for") == name
        for entry in _logged(("claim",))
    )


def _requests_handled() -> dict[str, datetime]:
    """When this account last shared or featured a post each thread asked for, by thread."""
    handled: dict[str, datetime] = {}
    for entry in _logged(("share", "feature", "boost")):
        ended = datetime.fromisoformat(entry["ended"])
        handled[entry.get("thread", "")] = max(ended, handled.get(entry.get("thread", ""), ended))
    return handled


def _follow_up_due(handled_at: datetime | None) -> bool:
    """Whether a request handled at ``handled_at`` is old enough for its claim follow-up."""
    follow_up = timedelta(hours=DMS.claim_follow_up_hours)
    return handled_at is not None and datetime.now(timezone.utc) - handled_at >= follow_up


def _logged(moves: tuple[str, ...], paths: list[Path] | None = None) -> list[dict[str, Any]]:
    """This account's moves of these kinds that succeeded, from the given days' sitting
    logs (every day's by default)."""
    entries = []
    for path in sorted(LOG_DIR.glob("*.jsonl")) if paths is None else paths:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("school") == school() and entry.get("move") in moves and entry.get("ok"):
                entries.append({**entry, "result": entry.get("result") or {}})
    return entries


def share(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Share a post they shared in the thread to our story; its event joins a carousel."""
    url = _their_share(device, args.thread, args.post)
    if device.free_data_megabytes() < EMULATOR.min_free_data_megabytes:
        raise MoveError("The emulator is low on storage; story shares wait")
    items.request_carousel(url, school=school())
    share_to_story(device, school(), url)
    return {"status": "shared to the story", "post": url}


def feature(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Put the events of a post they shared in the thread into an upcoming carousel."""
    url = _their_share(device, args.thread, args.post)
    items.request_carousel(url, school=school())
    return {"status": "requested for an upcoming carousel", "post": url}


def correction(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Queue what they wrote since our last message for the listing they say is wrong."""
    thread = _reader(device, args.thread).read()
    words = their_latest_words(thread)
    if not words:
        raise MoveError("They wrote nothing since our last message")
    items.queue_dm(words, school=school(), sender=sender(thread) or None)
    return {"status": "queued for the listing fix"}


def opt_out(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Leave the sender's club out of every carousel from now on."""
    handle = sender(_reader(device, args.thread).read())
    if not handle:
        raise MoveError("The sender's username could not be read")
    exclude_club(handle, reason=f"Asked in {school_account_username(school())}'s DMs")
    return {"status": "left out of carousels", "club": handle}


# --- the notification agent's moves ------------------------------------------------


def reply(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Send a short reply in the thread, only while their newest message is newer than
    ours (one reply per message of theirs), at most ``replies_per_thread_per_day`` in one
    thread and ``replies_per_account_per_day`` in all a day. A thread whose sender asked
    to be left out gets only the acknowledgement of that opt-out."""
    text = safe_reply(args.text)
    if text is None:
        raise MoveError(
            "Refused: the reply must be plain text up to "
            f"{DMS.reply_max_characters} characters, with no tag, no email but "
            f"{DMS.contact_email}, no link outside wat2do.io and no long number"
        )
    if _count("reply", thread=args.thread, hours=24) >= DMS.replies_per_thread_per_day:
        raise MoveError(
            f"Refused: this thread already got {DMS.replies_per_thread_per_day} replies today"
        )
    _within_cap("reply", DMS.replies_per_account_per_day)
    reader = _reader(device, args.thread)
    thread = reader.read()
    if thread and thread[-1]["from"] == "us":
        raise MoveError("Refused: we already answered their newest message")
    if _left_out(thread) and not _done("opt-out", thread=args.thread):
        raise MoveError("Refused: they asked to be left out; only an opt-out is acknowledged")
    _pace()
    reader.send_reply(text)
    return {"thread": args.thread, "status": "reply sent"}


def heart(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """React with a heart to their newest message, once per thread within
    ``thread_repeat_hours``."""
    _once_per_thread("heart", args.thread)
    _within_cap("heart", DMS.hearts_per_account_per_day)
    reader = _reader(device, args.thread)
    _refuse_if_left_out(reader.read())
    _pace()
    hearted = reader.heart()
    status = (
        "hearted their newest message" if hearted else "their newest message already had our heart"
    )
    return {"thread": args.thread, "status": status}


def boost(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Like and repost a post they shared in the thread, put its events in an upcoming
    carousel and share it to our story; each post once."""
    if any(
        args.post in (entry.get("post"), entry["result"].get("post"))
        for entry in _logged(("boost", "share"))
    ):
        raise MoveError("Refused: this post was already boosted or shared to our story")
    _within_cap("boost", DMS.boosts_per_account_per_day)
    reader = _reader(device, args.thread)
    thread = reader.read()
    _refuse_if_left_out(thread)
    url = _shared_in(thread, args.post)
    if device.free_data_megabytes() < EMULATOR.min_free_data_megabytes:
        raise MoveError("The emulator is low on storage; story shares wait")
    _pace()
    liked = True
    try:
        like_and_repost(device, user(), url)
    except EmulatorError:
        # The story share matters most; a like that failed is reported, not retried.
        liked = False
    items.request_carousel(url, school=school())
    share_to_story(device, school(), url)
    return {"status": "shared to the story", "post": url, "liked_and_reposted": liked}


def accept(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Accept the thread's message request."""
    reader = _reader(device, args.thread)
    _refuse_if_left_out(reader.read())
    _pace()
    accepted = reader.accept()
    return {"thread": args.thread, "status": "accepted" if accepted else "not a request"}


def mute(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Turn off our notifications of the sender's posts, stories and reels, so nothing
    of theirs is picked up again (after ``ig opt-out``)."""
    handle = sender(_reader(device, args.thread).read())
    if not handle:
        raise MoveError("The sender's username could not be read")
    _pace()
    reader = FollowingReader(device, user(), profile_wait_seconds=EMULATOR.screen_wait_seconds)
    outcome = reader.mute(handle)
    return {"status": outcome, "account": handle}


def find_event(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """The sender's club's events at this school from the last week on, each with the
    posted carousels it is a slide of, so a correction can name the event it fixes."""
    handle = sender(_reader(device, args.thread).read())
    if not handle:
        raise MoveError("The sender's username could not be read")
    events = _club_events(handle)
    slides = _posted_slides([event["id"] for event in events])
    return {
        "club": handle,
        "events": [{**event, "carousels": slides.get(event["id"], [])} for event in events],
    }


def fix_event(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Correct one of the sender's club's events the way the app's own edit does
    (``update_event_with_occurrences``), with only what they said was wrong."""
    handle = sender(_reader(device, args.thread).read())
    if not handle:
        raise MoveError("The sender's username could not be read")
    if args.event not in {event["id"] for event in _club_events(handle)}:
        raise MoveError(f"Event {args.event} is not one of {handle}'s events here")
    event = event_service.get_event(args.event)
    if event is None:
        raise MoveError(f"Event {args.event} is gone")
    patch: dict[str, Any] = {}
    if args.title:
        patch["title"] = plain(args.title)[:200]
    if args.location:
        # The map finds the new place again.
        patch.update(location=plain(args.location)[:200], map_location=None)
    if args.cancelled:
        patch["cancelled"] = True
    occurrences = _moved(event, args.start, args.end) if args.start or args.end else None
    if not patch and occurrences is None:
        raise MoveError("Nothing to fix: give --title, --location, --start, --end or --cancelled")
    event_service.update_event_and_occurrences(args.event, patch, occurrences)
    event_feed_revalidation_service.revalidate_schools([school()], resources=("events", "clubs"))
    return {"event": args.event, "fixed": sorted([*patch, *(["dates"] if occurrences else [])])}


def comments(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """The comments on this account's newest posted carousels: who wrote each, and
    whether we liked or pinned it. ``ig shot`` shows their words."""
    posts = [row for row in _batches(status=INSTAGRAM_BATCH_PUBLISHED) if row.get("permalink")]
    found = []
    for row in posts[:_COMMENTED_POSTS]:
        found.append(
            {
                "post": row["permalink"],
                "comments": [
                    {"author": c.author, "liked": c.liked, "pinned": c.pinned}
                    for c in read_comments(device, user(), row["permalink"])
                ],
            }
        )
    return {"posts": found}


def like_comment_move(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Like a comment on one of our posts (every one but spam, scams and hate)."""
    _ours(args.post)
    _within_cap("like-comment", DMS.comment_likes_per_account_per_day)
    _pace()
    liked = like_comment(device, user(), args.post, args.author)
    return {"post": args.post, "status": "liked" if liked else "already liked"}


def pin_comment_move(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Pin a genuine comment on one of our posts; at most three stay pinned per post."""
    _ours(args.post)
    _within_cap("pin-comment", DMS.pins_per_account_per_day)
    _pace()
    try:
        pinned = pin_comment(device, user(), args.post, args.author)
    except PinLimitReached as exc:
        raise MoveError(f"{exc}; leave the pins as they are") from exc
    return {"post": args.post, "status": "pinned" if pinned else "already pinned"}


# --- looking and touching ----------------------------------------------------------


def screen(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """What the screen shows: each labelled element with its tap point."""
    shown = []
    for node in device.screen():
        text = node.label.strip()
        if not text and not node.resource_id:
            continue
        x1, y1, x2, y2 = node.bounds
        shown.append(
            {"text": text[:120], "id": node.resource_id, "at": f"{(x1 + x2) // 2},{(y1 + y2) // 2}"}
        )
    return {"elements": shown[:150]}


def shot(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Save a screenshot in the sitting's folder for Claude to look at."""
    folder = Path(os.environ["WAT2DO_SITTING_DIR"])
    path = folder / f"screen-{int(time.time() * 1000)}.png"
    path.write_bytes(device.screenshot())
    return {"path": path.name}


def tap(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Tap an element by its label, or a point; never anything that sends a message."""
    nodes = device.screen()
    if args.at:
        x, y = (int(value) for value in args.at.split(","))
        under = [
            n for n in nodes if n.bounds[0] <= x <= n.bounds[2] and n.bounds[1] <= y <= n.bounds[3]
        ]
        if any(_SENDS.match(n.label.strip()) for n in under):
            raise MoveError("Refused: that point is a Send button")
        device.adb("shell", "input", "tap", str(x), str(y))
        return {"tapped": args.at}
    if _SENDS.match(args.label.strip()):
        raise MoveError("Refused: a person sends every message")
    wanted = re.compile(rf"^{re.escape(args.label)}$", re.IGNORECASE)
    node = next((n for n in nodes if wanted.match(n.label.strip())), None)
    if node is None:
        raise MoveError(f"Nothing labelled {args.label!r} is on screen")
    device.tap(node)
    return {"tapped": args.label}


def back(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    device.back()
    return {"status": "back"}


def scroll(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    (device.scroll_up if args.direction == "up" else device.scroll_down)()
    return {"scrolled": args.direction}


# --- helpers -----------------------------------------------------------------------


def safe_reply(text: object) -> str | None:
    """The reply as one line of plain text the emulator can type, or None if unsafe.

    Accents are folded to plain letters and anything else outside printable ASCII is
    dropped, since the emulator types through adb. A tag, an email address other than
    ours, a link to anywhere but Wat2Do, or a long number rejects the reply instead of
    being trimmed.
    """
    reply = plain(str(text or ""))
    if not reply or len(reply) > DMS.reply_max_characters:
        return None
    if "@" in reply.replace(DMS.contact_email, "") or _DIGITS.search(reply):
        return None
    if any(not _OUR_ADDRESS.match(address.rstrip(".,!?)")) for address in _ADDRESS.findall(reply)):
        return None
    return reply


def plain(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text.translate(_PLAIN_QUOTES))
    ascii_only = folded.encode("ascii", "ignore").decode()
    return " ".join("".join(ch for ch in ascii_only if ch.isprintable()).split())


def sender(thread: list[dict[str, Any]]) -> str:
    """The other account's username, or "" when the screen never showed it."""
    return next(
        (plain_handle(item.get("sender")) for item in thread if plain_handle(item.get("sender"))),
        "",
    )


def their_latest_words(thread: list[dict[str, Any]]) -> str:
    """What they wrote since our last message."""
    last_ours = max((i for i, item in enumerate(thread) if item.get("from") == "us"), default=-1)
    return "\n".join(
        str(item["text"])
        for item in thread[last_ours + 1 :]
        if item.get("from") == "them" and item.get("text")
    )


def claim_target(handle: str) -> ClaimTarget:
    """The club this school lists under ``handle``, unclaimed, not left out and never sent
    its claim message, with an outreach lead made for it if it has none."""
    wanted = plain_handle(handle)
    record = school_service.get_school(school())
    if record is None:
        raise MoveError("This school is not in the database")
    clubs = (
        get_sb()
        .table(CLUBS)
        .select("id,club_name,ig,created_by")
        .eq("school_id", record.id)
        # Any case, with or without "@"; the exact handle is checked below.
        .ilike("ig", f"%{wanted}")
        .execute()
    ).data or []
    club = next((c for c in clubs if plain_handle(c.get("ig")) == wanted), None)
    if club is None:
        raise MoveError(f"No club at this school has the Instagram account {wanted}")
    refuse_if_excluded(wanted)
    members = (
        get_sb().table(CLUB_MEMBERS).select("club_id").eq("club_id", club["id"]).limit(1).execute()
    ).data
    if club.get("created_by") or members:
        raise MoveError("This club already has an owner, so it has nothing to claim")
    if _claimed_before(club["id"], club["club_name"]):
        raise MoveError("This club was already sent its claim message; send it nothing more")
    leads = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select("claim_token,status")
        .eq("club_id", club["id"])
        .execute()
    ).data or []
    lead = next((lead for lead in leads if lead.get("status") != "claimed"), None)
    if lead is None:
        lead = (
            get_sb()
            .table(OUTREACH_LEADS)
            .insert({"club_id": club["id"], "notes": "Claim link drafted in a DM sitting."})
            .execute()
        ).data[0]
        leads.append(lead)
    return ClaimTarget(
        club_id=club["id"],
        name=club["club_name"],
        handle=wanted,
        token=str(lead["claim_token"]),
        tokens=frozenset(str(lead["claim_token"]).casefold() for lead in leads),
    )


def _reader(device: EmulatorDevice, thread: str) -> ThreadReader:
    return ThreadReader(device, school(), thread, lambda: open_row(device, user(), thread))


def _club_events(handle: str) -> list[dict[str, Any]]:
    """The club's events at this school, by its account or its club's, from a week ago on."""
    clubs = (
        get_sb()
        .table(CLUBS)
        .select("id,ig")
        .eq("school_id", _school_id())
        .ilike("ig", f"%{handle}")
        .execute()
    ).data or []
    club_ids = [club["id"] for club in clubs if plain_handle(club.get("ig")) == handle]
    owned = f"ig_handle.eq.{handle}" + (
        f",club_id.in.({','.join(str(club_id) for club_id in club_ids)})" if club_ids else ""
    )
    rows = (
        get_sb()
        .table(EVENTS)
        .select("id,title,location,cancelled")
        .eq("school_id", _school_id())
        .or_(owned)
        .order("id", desc=True)
        .limit(40)
        .execute()
    ).data or []
    since = datetime.now(timezone.utc) - timedelta(days=7)
    dates = event_date_service.list_for_events([row["id"] for row in rows])
    tz = ZoneInfo(school_service.get_school(school()).timezone)  # type: ignore[union-attr]
    events = []
    for row in rows:
        occurrences = [
            o for o in dates.get(row["id"], []) if (o.dtend_utc or o.dtstart_utc) >= since
        ]
        if occurrences:
            events.append(
                {
                    **row,
                    "dates": [
                        {
                            "start": o.dtstart_utc.astimezone(tz).strftime("%Y-%m-%dT%H:%M"),
                            "end": o.dtend_utc.astimezone(tz).strftime("%Y-%m-%dT%H:%M")
                            if o.dtend_utc
                            else None,
                        }
                        for o in occurrences
                    ],
                }
            )
    return events


def _posted_slides(event_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    """For each event, the posted carousels of this school it is a slide of."""
    if not event_ids:
        return {}
    items = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("event_id,batch_id,position")
        .in_("event_id", event_ids)
        .execute()
    ).data or []
    posted = {row["id"]: row for row in _batches(status=INSTAGRAM_BATCH_PUBLISHED)}
    found: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        batch = posted.get(item["batch_id"])
        if batch is not None:
            found.setdefault(item["event_id"], []).append(
                {"batch": batch["id"], "permalink": batch["permalink"]}
            )
    return found


def _moved(event: Any, start: str | None, end: str | None) -> list[OccurrenceUpdate]:
    """The event's dates with its first one moved to ``start``/``end`` (local times)."""
    record = school_service.get_school(school())
    tz = ZoneInfo(record.timezone if record else "America/Toronto")
    occurrences = sorted(event.occurrences, key=lambda o: o.dtstart_utc)
    if not occurrences:
        raise MoveError("The event has no date to move")
    first = occurrences[0]
    try:
        new_start = datetime.fromisoformat(start).replace(tzinfo=tz) if start else first.dtstart_utc
        new_end = datetime.fromisoformat(end).replace(tzinfo=tz) if end else None
    except ValueError as exc:
        raise MoveError("Give times as YYYY-MM-DDTHH:MM, local to the school") from exc
    if new_end is None and first.dtend_utc is not None:
        # A moved start keeps the event's length.
        new_end = new_start + (first.dtend_utc - first.dtstart_utc)
    moved = [OccurrenceUpdate(id=first.id, dtstart_utc=new_start, dtend_utc=new_end, tz=first.tz)]
    moved += [
        OccurrenceUpdate(
            id=o.id, dtstart_utc=o.dtstart_utc, dtend_utc=o.dtend_utc, duration=o.duration, tz=o.tz
        )
        for o in occurrences[1:]
    ]
    return moved


def _ours(permalink: str) -> None:
    """Refuse a post that is not one of this account's posted carousels."""
    posts = {row.get("permalink") for row in _batches(status=INSTAGRAM_BATCH_PUBLISHED)}
    if permalink not in posts:
        raise MoveError("That is not one of this account's posts")


def _left_out(thread: list[dict[str, Any]]) -> bool:
    """Whether the sender asked to be left out: their club is excluded, or their own
    words in the thread ask us to stop or to ask first."""
    if asks_to_be_left_out(thread):
        return True
    handle = sender(thread)
    try:
        if handle:
            refuse_if_excluded(handle)
    except LeftOut:
        return True
    return False


def _refuse_if_left_out(thread: list[dict[str, Any]]) -> None:
    if _left_out(thread):
        raise MoveError("Refused: they asked to be left out; nothing is done in this thread")


def _shared_in(thread: list[dict[str, Any]], url: str) -> str:
    """``url`` when they shared it in this thread with its owner readable."""
    if not any(
        item.get("from") == "them"
        and item.get("shared_url") == url
        and plain_handle(item.get("shared_owner"))
        for item in thread
    ):
        raise MoveError("That post was not shared by them in this thread")
    return url


def _entries(move: str) -> list[dict[str, Any]]:
    """This account's successful ``move``s in the last ``_LOG_DAYS`` days' logs."""
    today = datetime.now(TORONTO).date()
    days = [today - timedelta(days=offset) for offset in range(_LOG_DAYS)]
    return _logged((move,), [LOG_DIR / f"{day.isoformat()}.jsonl" for day in days])


def _done(move: str, *, thread: str | None = None, hours: float | None = None) -> bool:
    """Whether ``move`` succeeded (in ``thread``) within ``hours`` (``thread_repeat_hours``)."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours or DMS.thread_repeat_hours)
    return any(
        datetime.fromisoformat(entry["ended"]) >= since
        and (thread is None or entry.get("thread") == thread)
        for entry in _entries(move)
    )


def _count(move: str, *, thread: str, hours: float) -> int:
    """How many times ``move`` succeeded in ``thread`` within ``hours``."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return sum(
        1
        for entry in _entries(move)
        if datetime.fromisoformat(entry["ended"]) >= since and entry.get("thread") == thread
    )


def _once_per_thread(move: str, thread: str) -> None:
    if _done(move, thread=thread):
        raise MoveError(
            f"Refused: this thread already got a {move} in the last {DMS.thread_repeat_hours} h"
        )


def _within_cap(move: str, cap: int) -> None:
    today = datetime.now(TORONTO).date()
    sent = [
        entry
        for entry in _entries(move)
        if datetime.fromisoformat(entry["ended"]).astimezone(TORONTO).date() == today
    ]
    if len(sent) >= cap:
        raise MoveError(f"This account has done its {cap} {move} moves for today")


def _pace() -> None:
    """A person's pause before anything others can see, so the account never acts in a burst."""
    time.sleep(random.uniform(DMS.send_wait_min_seconds, DMS.send_wait_max_seconds))


def _without_claim_links(text: str) -> str:
    """A claim link carries its club's token, which a sitting never needs to see: one we
    typed shows in its thread and in the inbox once the draft or message is there."""
    return CLAIM_LINK.sub("[claim link]", text)


def _their_share(device: EmulatorDevice, thread: str, url: str) -> str:
    """``url`` when they shared it in this thread with its owner readable; a message
    can be written to trick Claude, so acting on a post needs proof from the thread."""
    return _shared_in(_reader(device, thread).read(), url)


def _today() -> str:
    return datetime.now(TORONTO).date().isoformat()


def _batches(**filters: str) -> list[dict[str, Any]]:
    query = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select(
            "id,status,permalink,published_at,updated_at,music_status,music_attempts,"
            "music_track,story_status"
        )
        .eq("school_id", _school_id())
        .eq("batch_kind", "events")
    )
    for column, value in filters.items():
        query = query.eq(column, value)
    return query.order("created_at", desc=True).limit(5).execute().data or []


def _school_id() -> int:
    record = school_service.get_school(school())
    if record is None:
        raise MoveError("This school is not in the database")
    return record.id


def _batch(batch_id: str) -> dict[str, Any]:
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select("music_track,music_error")
        .eq("id", batch_id)
        .execute()
    ).data or [{}]
    return rows[0]


def _slides(batch_id: str) -> int:
    rows = (
        get_sb().table(INSTAGRAM_PUBLISH_ITEMS).select("id").eq("batch_id", batch_id).execute()
    ).data or []
    return len(rows)


def _todays_draft() -> dict[str, Any] | None:
    rows = _batches(local_date=_today())
    if not rows:
        return None
    row = rows[0]
    return {**row, "slides": _slides(row["id"])}


def _waiting_carousel() -> dict[str, Any] | None:
    """The newest posted carousel still waiting for its like and song."""
    oldest = datetime.now(timezone.utc) - timedelta(hours=PUBLISHING.music_max_age_hours)
    rows = [
        row
        for row in _batches(status=INSTAGRAM_BATCH_PUBLISHED)
        if row.get("music_status") == INSTAGRAM_MUSIC_PENDING
        and row.get("published_at")
        and datetime.fromisoformat(row["published_at"]) >= oldest
    ]
    return rows[0] if rows else None


def _story_carousel() -> dict[str, Any] | None:
    oldest = datetime.now(timezone.utc) - timedelta(hours=PUBLISHING.story_max_age_hours)
    rows = [
        row
        for row in _batches(status=INSTAGRAM_BATCH_PUBLISHED)
        if row.get("story_status") == stories.STORY_PENDING
        and row.get("published_at")
        and datetime.fromisoformat(row["published_at"]) >= oldest
    ]
    return rows[0] if rows else None


def _log(entry: dict[str, Any]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / f"{_today()}.jsonl"
    with path.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


MOVES: dict[str, Callable[[EmulatorDevice, argparse.Namespace], dict[str, Any]]] = {
    "status": status,
    "post": post,
    "finish": finish,
    "stories": share_stories,
    "milestones": milestone_report,
    "milestone-story": milestone_story,
    "inbox": inbox,
    "read": read,
    "claim": claim,
    "share": share,
    "feature": feature,
    "correction": correction,
    "opt-out": opt_out,
    "reply": reply,
    "heart": heart,
    "boost": boost,
    "accept": accept,
    "mute": mute,
    "find-event": find_event,
    "comments": comments,
    "like-comment": like_comment_move,
    "pin-comment": pin_comment_move,
    "fix-event": fix_event,
    "screen": screen,
    "shot": shot,
    "tap": tap,
    "back": back,
    "scroll": scroll,
}
# Moves whose answer the log keeps (never a message's text).
_LOGGED_RESULTS = frozenset(
    {
        "post",
        "finish",
        "stories",
        "milestones",
        "milestone-story",
        "share",
        "claim",
        "feature",
        "boost",
        "accept",
        "mute",
        "fix-event",
        "like-comment",
        "pin-comment",
    }
)


def parser() -> argparse.ArgumentParser:
    parse = argparse.ArgumentParser(prog="ig", description=__doc__)
    commands = parse.add_subparsers(dest="move", required=True)
    for name in ("status", "post", "finish", "stories", "milestones", "inbox", "screen"):
        commands.add_parser(name)
    for name in ("shot", "back", "comments"):
        commands.add_parser(name)
    for name in ("read", "correction", "opt-out", "heart", "accept", "mute", "find-event"):
        commands.add_parser(name).add_argument("thread")
    answer = commands.add_parser("reply")
    answer.add_argument("thread")
    answer.add_argument("--text", required=True)
    story = commands.add_parser("milestone-story").add_mutually_exclusive_group(required=True)
    story.add_argument("--followers", type=int)
    story.add_argument("--likes", metavar="POST")
    for name in ("like-comment", "pin-comment"):
        comment = commands.add_parser(name)
        comment.add_argument("--post", required=True)
        comment.add_argument("--author", required=True)
    fix = commands.add_parser("fix-event")
    fix.add_argument("thread")
    fix.add_argument("--event", type=int, required=True)
    fix.add_argument("--title")
    fix.add_argument("--location")
    fix.add_argument("--start")
    fix.add_argument("--end")
    fix.add_argument("--cancelled", action="store_true")
    send = commands.add_parser("claim")
    send.add_argument("thread")
    send.add_argument("username")
    for name in ("share", "feature", "boost"):
        action = commands.add_parser(name)
        action.add_argument("thread")
        action.add_argument("--post", required=True)
    touch = commands.add_parser("tap")
    where = touch.add_mutually_exclusive_group(required=True)
    where.add_argument("--label")
    where.add_argument("--at")
    commands.add_parser("scroll").add_argument("direction", choices=("up", "down"))
    return parse


def main(argv: list[str] | None = None) -> int:
    # Claude reads only the move's JSON answer, not the libraries' request logs.
    logging.disable(logging.INFO)
    args = parser().parse_args(argv)
    if args.move == "claim" and os.environ.get(notification.RUN):
        print(json.dumps({"error": "Refused: a claim is only a follow-up from the daily sitting"}))
        return 1
    recording = os.environ.get(notification.DRY_RUN)
    if recording:
        print(json.dumps(_dry_run(args, Path(recording)), ensure_ascii=False, default=str))
        return 0
    started = datetime.now(timezone.utc)
    entry: dict[str, Any] = {"school": school(), "move": args.move, "started": started.isoformat()}
    if getattr(args, "thread", None):
        entry["thread"] = args.thread
    if getattr(args, "post", None):
        entry["post"] = args.post
    device = EmulatorDevice()
    try:
        with exclusive():
            try:
                result = _move(device, args)
            finally:
                _stop_at_a_challenge(device, args.move)
        entry["ok"] = True
        code = 0
    except (MoveError, EmulatorError) as exc:
        result = {"error": str(exc)}
        entry.update(ok=False, error=str(exc)[:200])
        code = 1
    entry["ended"] = datetime.now(timezone.utc).isoformat()
    if args.move in _LOGGED_RESULTS:
        entry["result"] = {k: v for k, v in result.items() if k not in ("messages",)}
    _log(entry)
    print(json.dumps(result, ensure_ascii=False, default=str))
    return code


def _move(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    paused = notification.paused_until(school())
    if args.move in _ACTING and paused is not None:
        raise MoveError(
            f"Refused: this account's notification handling is paused until {paused} "
            "after Instagram showed a challenge"
        )
    if args.move in _MESSAGING:
        refuse_dms(school())
    return MOVES[args.move](device, args)


def _stop_at_a_challenge(device: EmulatorDevice, move: str) -> None:
    """After any move but a plain look, a challenge, an action limit or a login screen
    pauses the account and stops the move, so nothing pushes through it."""
    if move in _READING - {"read"}:
        return
    try:
        shown = device.challenge()
    except EmulatorError:
        return
    if shown is not None:
        notification.pause(school(), shown)
        raise MoveError(
            f"Stopped: Instagram showed {shown!r}. This account rests for "
            f"{DMS.challenge_pause_hours} h; stop now and report it in problems"
        )


def _dry_run(args: argparse.Namespace, recording: Path) -> dict[str, Any]:
    """What the move would do, from a recorded thread (``notification.DryRun``); nothing
    touches the emulator or the database."""
    recorded = json.loads(recording.read_text())
    thread = recorded["messages"]
    if args.move == "inbox":
        return {"threads": recorded["inbox"]}
    if args.move == "read":
        if args.thread != recorded["thread"]:
            return {"error": "The DM thread is no longer in the inbox"}
        return {"thread": args.thread, "stale": False, "messages": thread}
    if args.move == "comments":
        return {"posts": recorded.get("posts", [])}
    if args.move == "find-event":
        return {"club": recorded.get("club", ""), "events": recorded.get("events", [])}
    if args.move == "reply" and safe_reply(args.text) is None:
        return {"error": "Refused: the reply is not safe to send"}
    if args.move in ("boost", "share", "feature"):
        try:
            _shared_in(thread, args.post)
        except MoveError as exc:
            return {"error": str(exc)}
    if args.move in ("reply", "heart", "boost", "accept", "claim", "share", "feature"):
        if asks_to_be_left_out(thread) and not (
            args.move == "reply" and "opt-out" in recorded.get("done", [])
        ):
            return {"error": "Refused: they asked to be left out; nothing is done in this thread"}
    recorded.setdefault("done", []).append(args.move)
    recording.write_text(json.dumps(recorded))
    return {"thread": getattr(args, "thread", None), "status": f"{args.move} done"}


if __name__ == "__main__":
    sys.exit(main())
