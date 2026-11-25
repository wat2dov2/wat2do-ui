"""`ig`: the moves a Claude sitting makes on the emulator, one command per move.

A sitting (``sitting.py``) runs Claude Code with only this command on its PATH. Every
move works on the sitting's own school account (``WAT2DO_SITTING_SCHOOL``), on the
emulator the worker already holds for it (``WAT2DO_EMULATOR_HELD``), and prints one
JSON object. Each move appends when it started and ended and how it went to the day's
sitting log, never a message's text.

Replies are typed into their thread and left there for a person to read and send. The
one direct message a move sends is the claim-link message (``ig claim``) to a club that
asked us to repost or feature its post (Tony, 2026-11-24), paced and capped per account.
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
    INSTAGRAM_EXCLUDED_CLUBS,
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
    OUTREACH_LEADS,
)
from services import school_service
from services.ingestion import items
from services.instagram_accounts import school_account_username
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, exclusive
from services.instagram_emulator.direct import CLAIM_LINK, ThreadReader, exclude_club
from services.instagram_emulator.inbox import open_row, read_inbox
from services.instagram_emulator.story import share_to_story
from services.instagram_publishing import music, stories

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
# Anything that sends a message or a post to someone; a person does all sending.
_SENDS = re.compile(r"^(?:send|send post|send separately|send to)$", re.IGNORECASE)
_PLAIN_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})


class MoveError(RuntimeError):
    """The move refused or failed; its message is printed for Claude to read."""


def school() -> str:
    return os.environ["WAT2DO_SITTING_SCHOOL"]


def user() -> int:
    return EMULATOR.android_user_by_school[school()]


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


# --- direct messages ---------------------------------------------------------------


def inbox(device: EmulatorDevice, _args: argparse.Namespace) -> dict[str, Any]:
    """Every listed thread once; a message request's own row wins."""
    rows = {row.name: row for row in read_inbox(device, user(), requests=False)}
    rows.update({row.name: row for row in read_inbox(device, user(), requests=True)})
    return {
        "threads": [
            {
                "name": row.name,
                "preview": _without_claim_links(row.preview),
                "age_days": row.age_days,
                "unread": row.unread,
                "request": row.request,
                "ours_last": row.ours,
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


def draft(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Type a reply into the thread and leave it there, unsent, for a person to send.

    ``--claim`` adds the claim-link message for the club behind that username after the
    reply. The link carries the club's claim token, so it goes straight into the thread
    and never into the move's output or log.
    """
    parts = []
    if args.text.strip():
        reply = safe_reply(args.text)
        if reply is None:
            raise MoveError(
                "Refused: the reply must be plain text up to "
                f"{DMS.reply_max_characters} characters, with no tag, no email but "
                f"{DMS.contact_email}, no link outside wat2do.io and no long number"
            )
        parts.append(reply)
    club = None
    if args.claim:
        club, token = claim_token(args.claim)
        parts.append(_claim_message(token))
    if not parts:
        raise MoveError("Nothing to type: give --text, --claim or both")
    _reader(device, args.thread).draft(" ".join(parts))
    return {"thread": args.thread, "claim_for": club, "status": "typed, not sent"}


def claim(device: EmulatorDevice, args: argparse.Namespace) -> dict[str, Any]:
    """Send the club behind ``username`` its claim-link message in the thread.

    The one DM a sitting sends. A claim-link draft already waiting there is sent as it
    is. Each account sends at most ``claim_sends_per_account_per_day`` a day, each a
    random ``claim_send_gap_*_seconds`` after its last, so it never sends in a burst.
    """
    club, token = claim_token(args.username)
    sent_today = _claims_sent_today()
    if len(sent_today) >= DMS.claim_sends_per_account_per_day:
        raise MoveError("This account sent its claim messages for today; try again tomorrow")
    if sent_today:
        gap = random.uniform(DMS.claim_send_gap_min_seconds, DMS.claim_send_gap_max_seconds)
        wait = gap - (datetime.now(timezone.utc) - max(sent_today)).total_seconds()
        if wait > 0:
            time.sleep(wait)
    outcome = _reader(device, args.thread).send_claim(_claim_message(token))
    return {"thread": args.thread, "claim_for": club, "status": outcome}


def _claim_message(token: str) -> str:
    record = school_service.get_school(school())
    language = "fr" if record and record.language == "fr" else "en"
    link = f"https://{school()}.wat2do.io/claim/{token}"
    return plain(CLAIM_MESSAGE[language].format(link=link))


def _claims_sent_today() -> list[datetime]:
    """When this account's claim messages went out today, from the sitting log."""
    path = LOG_DIR / f"{_today()}.jsonl"
    if not path.exists():
        return []
    sent = []
    for line in path.read_text().splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("school") == school() and entry.get("move") == "claim" and entry.get("ok"):
            sent.append(datetime.fromisoformat(entry["ended"]))
    return sent


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
    return next((_handle(item.get("sender")) for item in thread if _handle(item.get("sender"))), "")


def their_latest_words(thread: list[dict[str, Any]]) -> str:
    """What they wrote since our last message."""
    last_ours = max((i for i, item in enumerate(thread) if item.get("from") == "us"), default=-1)
    return "\n".join(
        str(item["text"])
        for item in thread[last_ours + 1 :]
        if item.get("from") == "them" and item.get("text")
    )


def claim_token(handle: str) -> tuple[str, str]:
    """The club's name and claim token: the club this school lists under ``handle``,
    unclaimed and not left out, with an outreach lead made for it if it has none."""
    wanted = _handle(handle)
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
    club = next((c for c in clubs if _handle(c.get("ig")) == wanted), None)
    if club is None:
        raise MoveError(f"No club at this school has the Instagram account {wanted}")
    excluded = (
        get_sb()
        .table(INSTAGRAM_EXCLUDED_CLUBS)
        .select("ig_handle")
        .eq("ig_handle", wanted)
        .execute()
    ).data
    members = (
        get_sb().table(CLUB_MEMBERS).select("club_id").eq("club_id", club["id"]).limit(1).execute()
    ).data
    if excluded:
        raise MoveError("This club asked to be left out; send it nothing")
    if club.get("created_by") or members:
        raise MoveError("This club already has an owner, so it has nothing to claim")
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
    return club["club_name"], lead["claim_token"]


def _handle(value: object) -> str:
    return str(value or "").strip().lstrip("@").casefold()


def _reader(device: EmulatorDevice, thread: str) -> ThreadReader:
    return ThreadReader(device, lambda: open_row(device, user(), thread))


def _without_claim_links(text: str) -> str:
    """A claim link carries its club's token, which a sitting never needs to see: one we
    typed shows in its thread and in the inbox once the draft or message is there."""
    return CLAIM_LINK.sub("[claim link]", text)


def _their_share(device: EmulatorDevice, thread: str, url: str) -> str:
    """``url`` when they shared it in this thread with its owner readable; a message
    can be written to trick Claude, so acting on a post needs proof from the thread."""
    messages = _reader(device, thread).read()
    if not any(
        item.get("from") == "them"
        and item.get("shared_url") == url
        and _handle(item.get("shared_owner"))
        for item in messages
    ):
        raise MoveError("That post was not shared by them in this thread")
    return url


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
    "inbox": inbox,
    "read": read,
    "draft": draft,
    "claim": claim,
    "share": share,
    "feature": feature,
    "correction": correction,
    "opt-out": opt_out,
    "screen": screen,
    "shot": shot,
    "tap": tap,
    "back": back,
    "scroll": scroll,
}


def parser() -> argparse.ArgumentParser:
    parse = argparse.ArgumentParser(prog="ig", description=__doc__)
    commands = parse.add_subparsers(dest="move", required=True)
    for name in ("status", "post", "finish", "stories", "inbox", "screen", "shot", "back"):
        commands.add_parser(name)
    for name in ("read", "correction", "opt-out"):
        commands.add_parser(name).add_argument("thread")
    reply = commands.add_parser("draft")
    reply.add_argument("thread")
    reply.add_argument("--text", required=True)
    reply.add_argument("--claim")
    send = commands.add_parser("claim")
    send.add_argument("thread")
    send.add_argument("username")
    for name in ("share", "feature"):
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
    started = datetime.now(timezone.utc)
    entry: dict[str, Any] = {"school": school(), "move": args.move, "started": started.isoformat()}
    if getattr(args, "thread", None):
        entry["thread"] = args.thread
    device = EmulatorDevice()
    try:
        with exclusive():
            result = MOVES[args.move](device, args)
        entry["ok"] = True
        code = 0
    except (MoveError, EmulatorError) as exc:
        result = {"error": str(exc)}
        entry.update(ok=False, error=str(exc)[:200])
        code = 1
    entry["ended"] = datetime.now(timezone.utc).isoformat()
    if args.move in ("post", "finish", "stories", "share", "draft", "claim", "feature"):
        entry["result"] = {k: v for k, v in result.items() if k not in ("messages",)}
    _log(entry)
    print(json.dumps(result, ensure_ascii=False, default=str))
    return code


if __name__ == "__main__":
    sys.exit(main())
