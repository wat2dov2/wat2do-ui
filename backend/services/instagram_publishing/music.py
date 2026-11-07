"""Songs for published carousels, added on the Mac from the Instagram app.

Admins keep a list of songs, typed loosely, through the API
(``rust/src/api/routes/instagram_publishing/songs.rs``). Some minutes after a carousel
publishes, the emulator worker visits its school's account and ``finish_due`` opens
the live post, likes and reposts it, and tries the songs in random order: Instagram's
music search finds candidates and Claude Haiku picks the track the admin meant, or none
so the next song is tried. A song marked Asian or K-pop is tried only at the control
box's ``asian_song_schools``. On the first try it also comments a GIF: Haiku names a
movie or show scene that fits the carousel's first event (or none), and picks a real
movie or show clip from GIPHY's results (or none, so nothing is commented). The same
edit tags the post with the school's own place: the first one Instagram's location
search lists under the school's exact name, else the one Haiku recognizes as the
school itself, or none.
"""

from __future__ import annotations

import io
import json
import logging
import random
import re
import shutil
import tempfile
import unicodedata
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.constants import (
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_MUSIC_ADDED,
    INSTAGRAM_MUSIC_FAILED,
    INSTAGRAM_MUSIC_PENDING,
)
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INSTAGRAM_PUBLISH_BATCHES, INSTAGRAM_PUBLISH_ITEMS, INSTAGRAM_SONGS
from services import school_service
from services.claude_code import ClaudeCodeError, ClaudeLimited, run_agent
from services.instagram_emulator.audio import GifComment, PlaceTag, SongNotFound, finish_post
from services.instagram_emulator.device import EmulatorDevice

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
WORKDIR_PREFIX = "wat2do-music-"
PROMPT = (Path(__file__).parent / "music_prompt.md").read_text()
GIF_QUERY_PROMPT = (Path(__file__).parent / "gif_query_prompt.md").read_text()
GIF_PICK_PROMPT = (Path(__file__).parent / "gif_pick_prompt.md").read_text()
PLACE_PROMPT = (Path(__file__).parent / "place_prompt.md").read_text()
GIF_QUERY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"query": {"type": ["string", "null"]}, "reason": {"type": "string"}},
    "required": ["query", "reason"],
    "additionalProperties": False,
}

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "index": {"type": ["integer", "null"]},
        "reason": {"type": "string"},
    },
    "required": ["index", "reason"],
    "additionalProperties": False,
}


def list_songs() -> list[dict[str, Any]]:
    response = get_sb().table(INSTAGRAM_SONGS).select("*").order("created_at", desc=True).execute()
    return response.data or []


def schools_due(now: datetime | None = None) -> list[str]:
    """Schools with a published carousel waiting for its song, longest waiting first."""
    if not list_songs():
        return []
    schools = [batch["school"] for batch in _pending_batches(now or datetime.now(timezone.utc))]
    return list(dict.fromkeys(schools))


def finish_due(device: EmulatorDevice, school: str, now: datetime | None = None) -> dict[str, int]:
    """Add a song to each of the school's carousels that has waited long enough.

    The worker calls this with the app already on the school's account.
    """
    songs = list_songs()
    outcomes: dict[str, int] = {}
    for batch in _pending_batches(now or datetime.now(timezone.utc)):
        if batch["school"] != school:
            continue
        playable = _songs_for(school, songs)
        if not playable:
            continue
        outcome = _add_music(device, batch, random.sample(playable, len(playable)))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    return outcomes


def _songs_for(school: str | None, songs: list[dict[str, Any]]) -> list[str]:
    """Every song can play anywhere except Asian and K-pop ones, kept to Asian campuses."""
    asian_campus = school in _CONTROL.asian_song_schools
    return [song["query"] for song in songs if asian_campus or not song.get("asian_campuses_only")]


def _pending_batches(now: datetime) -> list[dict[str, Any]]:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select(f"id,permalink,music_attempts,updated_at,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("status", INSTAGRAM_BATCH_PUBLISHED)
        .eq("music_status", INSTAGRAM_MUSIC_PENDING)
        .lte("published_at", (now - timedelta(minutes=_CONTROL.music_delay_minutes)).isoformat())
        .gte("published_at", (now - timedelta(hours=_CONTROL.music_max_age_hours)).isoformat())
        .order("published_at")
        .execute()
    )
    # A failed try waits before the next, so one bad spell on the emulator cannot use
    # up every attempt.
    retry_after = now - timedelta(minutes=_CONTROL.music_retry_minutes)
    return [
        school_service.with_school_slug(row)
        for row in response.data or []
        if not row["music_attempts"] or datetime.fromisoformat(row["updated_at"]) <= retry_after
    ]


def _add_music(device: EmulatorDevice, batch: dict[str, Any], songs: Sequence[str]) -> str:
    attempts = int(batch["music_attempts"]) + 1
    # Only the first try comments, so a retry never posts a second GIF.
    gif = gif_comment(batch["id"]) if attempts == 1 and _CONTROL.gif_comments else None
    place = _place_tag(batch["school"])
    try:
        added = finish_post(
            device, batch["school"], batch["permalink"], songs, choose_track, gif, place
        )
    except SongNotFound as exc:
        _record(batch["id"], INSTAGRAM_MUSIC_FAILED, attempts, error=str(exc))
        return INSTAGRAM_MUSIC_FAILED
    except ClaudeLimited as exc:
        # No song can be picked until Claude's usage limit resets. The try still counts,
        # so the GIF is never commented twice, but it never gives the carousel up.
        log.warning("Adding music to Instagram batch %s waits: %s", batch["id"], exc)
        _record(batch["id"], INSTAGRAM_MUSIC_PENDING, attempts, error=str(exc)[:500])
        return INSTAGRAM_MUSIC_PENDING
    except Exception as exc:
        log.exception("Adding music to Instagram batch %s failed", batch["id"])
        final = attempts >= _CONTROL.music_attempts
        status = INSTAGRAM_MUSIC_FAILED if final else INSTAGRAM_MUSIC_PENDING
        _record(batch["id"], status, attempts, error=str(exc)[:500])
        return status
    _record(batch["id"], INSTAGRAM_MUSIC_ADDED, attempts, track=added.track)
    return INSTAGRAM_MUSIC_ADDED


def gif_comment(batch_id: str) -> GifComment | None:
    """The GIF search for the carousel's first event, or None when no scene fits."""
    try:
        event = _first_event(batch_id)
        if event is None:
            return None
        workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
        try:
            (Path(workdir) / "event.json").write_text(json.dumps(event, ensure_ascii=False))
            answer = run_agent(
                GIF_QUERY_PROMPT,
                workdir=workdir,
                model=_CONTROL.music_model,
                tools=("Read",),
                allowed_tools=("Read(./**)",),
                schema=GIF_QUERY_SCHEMA,
                timeout=_CONTROL.music_agent_timeout_seconds,
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    except Exception:
        log.warning("No GIF search for Instagram batch %s", batch_id, exc_info=True)
        return None
    query = " ".join(str(answer.get("query") or "").split())[:60]
    if not query:
        return None
    return GifComment(query, lambda screenshot, boxes: pick_gif(event, query, screenshot, boxes))


def pick_gif(
    event: dict[str, Any],
    query: str,
    screenshot: bytes,
    boxes: Sequence[tuple[int, int, int, int]],
) -> int | None:
    """The index of the result that is a fitting movie or show clip, or None."""
    from PIL import Image, ImageDraw

    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        with Image.open(io.BytesIO(screenshot)) as shot:
            image = shot.convert("RGB")
        draw = ImageDraw.Draw(image)
        for index, (x1, y1, x2, y2) in enumerate(boxes):
            draw.rectangle((x1, y1, x2, y2), outline=(255, 0, 0), width=6)
            draw.rectangle((x1, y1, x1 + 70, y1 + 70), fill=(255, 0, 0))
            draw.text((x1 + 18, y1 + 8), str(index), fill=(255, 255, 255), font_size=50)
        top = min(box[1] for box in boxes)
        bottom = max(box[3] for box in boxes)
        image.crop((0, top, image.width, bottom)).save(Path(workdir) / "results.png")
        (Path(workdir) / "event.json").write_text(json.dumps(event, ensure_ascii=False))
        answer = run_agent(
            GIF_PICK_PROMPT.replace("{{query}}", query),
            workdir=workdir,
            model=_CONTROL.music_model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=_CONTROL.music_agent_timeout_seconds,
        )
    except Exception:
        log.warning("The GIF picker did not answer", exc_info=True)
        return None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    index = answer.get("index")
    return index if isinstance(index, int) and 0 <= index < len(boxes) else None


def _first_event(batch_id: str) -> dict[str, Any] | None:
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("position,event:events(title,description,category,club)")
        .eq("batch_id", str(batch_id))
        .order("position")
        .limit(1)
        .execute()
    ).data or []
    event = rows[0].get("event") if rows else None
    if not event:
        return None
    return {**event, "description": (event.get("description") or "")[:1500]}


def choose_track(query: str, tracks: Sequence[str]) -> int | None:
    """The index of the track the admin meant by ``query``, or None when none is it."""
    try:
        return _ask_index(PROMPT.replace("{{query}}", query), "tracks.json", tracks)
    except ClaudeLimited:
        # Not an answer about this song: every song would fail the same way.
        raise
    except ClaudeCodeError:
        log.warning("The track picker did not answer for one song")
        return None


def _place_tag(school: str | None) -> PlaceTag | None:
    """The school's own place to tag its carousel with, found by its full name."""
    try:
        record = school_service.get_school(school)
    except Exception:
        # The place is a nice extra; it never holds up the song.
        log.warning("Could not read %s's name to tag its place", school, exc_info=True)
        return None
    return PlaceTag(record.name, choose_place) if record is not None else None


def choose_place(name: str, places: Sequence[str]) -> int | None:
    """The index of the place that is the school: the first Instagram lists under its
    exact name, else the one Claude Haiku recognizes as the school itself, or None."""
    wanted = _comparable(name)
    exact = next((i for i, place in enumerate(places) if _comparable(place) == wanted), None)
    if exact is not None:
        return exact
    try:
        return _ask_index(PLACE_PROMPT.replace("{{school}}", name), "places.json", places)
    except ClaudeCodeError:
        # The place is a nice extra; without an answer the post stays untagged.
        log.warning("The place picker did not answer")
        return None


def _comparable(name: str) -> str:
    """A place name without accents, case or punctuation, so "Queen’s" and "Queen's" match."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().casefold()
    # A curly apostrophe has no ASCII form and drops out, so a straight one goes too.
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded.replace("'", "")).split())


def _ask_index(prompt: str, file_name: str, choices: Sequence[str]) -> int | None:
    """Claude Haiku's pick among ``choices``, written to ``file_name`` for it to read."""
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / file_name).write_text(json.dumps(list(choices), ensure_ascii=False))
        answer = run_agent(
            prompt,
            workdir=workdir,
            model=_CONTROL.music_model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=_CONTROL.music_agent_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    index = answer.get("index")
    return index if isinstance(index, int) and 0 <= index < len(choices) else None


def _record(
    batch_id: str,
    status: str,
    attempts: int,
    *,
    track: str | None = None,
    error: str | None = None,
) -> None:
    get_sb().table(INSTAGRAM_PUBLISH_BATCHES).update(
        {
            "music_status": status,
            "music_track": track,
            "music_error": error,
            "music_attempts": attempts,
            # When this try ended, which the next try waits from.
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", batch_id).execute()
