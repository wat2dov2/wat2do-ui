"""Songs for posted carousels, added on the Mac from the Instagram app.

Admins keep a list of songs, typed loosely, through the API
(``rust/src/api/routes/instagram_publishing/songs.rs``). Right after a sitting posts a
carousel, its ``ig finish`` move (``services/instagram_sessions/moves.py``) calls
``finish``: it opens the live post, likes and reposts it, and tries the songs in the
day's rotation order: Instagram's music search finds candidates and Claude Haiku picks
the track the admin meant, or none so the next song is tried. The control box's
``asian_song_schools`` play only the songs marked Asian or K-pop, and every other school
plays only the rest. Each day the rotation moves one song on, so every school in a group
gets the same song that day. On the first try it also comments a GIF: Haiku names a
movie or show scene that fits the carousel's first event (or none), and picks a real
movie or show clip from GIPHY's results (or none, so nothing is commented). The same
edit tags the post with the school's own place: the first one Instagram's location
search lists under the school's exact name, else the one Haiku recognizes as the
school itself, or none, and tags each event slide with the club behind its event
(``slide_tags``); a club that lets only accounts it follows tag it is left untagged.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import tempfile
import unicodedata
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from core.constants import (
    INSTAGRAM_MUSIC_ADDED,
    INSTAGRAM_MUSIC_FAILED,
    INSTAGRAM_MUSIC_PENDING,
)
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INSTAGRAM_PUBLISH_BATCHES, INSTAGRAM_PUBLISH_ITEMS, INSTAGRAM_SONGS
from services import school_service
from services.claude_code import ClaudeCodeError, ClaudeLimited, run_agent
from services.instagram_emulator.audio import (
    GifComment,
    GifScene,
    PlaceTag,
    SlideTag,
    SongNotFound,
    finish_post,
)
from services.instagram_emulator.device import EmulatorDevice

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
_TORONTO = ZoneInfo("America/Toronto")
WORKDIR_PREFIX = "wat2do-music-"
# The GIF searches used lately, so 37 schools' carousels do not all get the same scene.
RECENT_GIFS_PATH = Path.home() / ".local/state/wat2do/instagram-gifs/recent.json"
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


def _songs_for(school: str | None, songs: list[dict[str, Any]]) -> list[str]:
    """Asian campuses play only the Asian and K-pop songs; every other campus the rest."""
    asian_campus = school in _CONTROL.asian_song_schools
    return [
        song["query"] for song in songs if bool(song.get("asian_campuses_only")) == asian_campus
    ]


def rotation(songs: Sequence[str], day: date) -> list[str]:
    """The songs in the order to try them on ``day``: the day's song, then the ones after it.

    The order is a fixed shuffle (by hash, so it never depends on when a song was
    added), and each day starts one song further on. Every school given the same list
    tries the same song first on the same day.
    """
    ordered = sorted(songs, key=lambda query: hashlib.sha256(query.casefold().encode()).digest())
    start = day.toordinal() % len(ordered) if ordered else 0
    return ordered[start:] + ordered[:start]


def _posting_day(published_at: str | None) -> date:
    """The Toronto date the carousel went up, so a retry after midnight keeps its song."""
    moment = datetime.fromisoformat(published_at) if published_at else datetime.now(timezone.utc)
    return moment.astimezone(_TORONTO).date()


def finish(device: EmulatorDevice, batch: dict[str, Any]) -> str:
    """Like, repost, comment, tag and set the song of the posted ``batch`` (its ``id``,
    ``permalink``, ``published_at``, ``music_attempts`` and ``school``); the outcome.

    The sitting holds the emulator on the school's account. A failed try counts, and
    the carousel's song is given up after the control box's ``music_attempts`` tries.
    """
    playable = _songs_for(batch["school"], list_songs())
    if not playable:
        return "no_songs"
    songs = rotation(playable, _posting_day(batch.get("published_at")))
    attempts = int(batch["music_attempts"]) + 1
    # Only the first try comments, so a retry never posts a second GIF.
    gif = _gif_scene(batch["id"]) if attempts == 1 and _CONTROL.gif_comments else None
    place = _place_tag(batch["school"])
    clubs = slide_tags(batch["id"])
    try:
        added = finish_post(
            device, batch["school"], batch["permalink"], songs, choose_track, gif, place, clubs
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


def _gif_scene(batch_id: str) -> GifScene:
    """Start Claude naming the carousel's GIF scene now, while the app opens, likes and
    reposts the post; asking for the comment waits for its answer."""
    scenes = ThreadPoolExecutor(max_workers=1, thread_name_prefix="instagram-gif-scene")
    answer = scenes.submit(gif_comment, batch_id)
    # The thread ends once this one answer is in.
    scenes.shutdown(wait=False)
    return answer.result


def gif_comment(batch_id: str) -> GifComment | None:
    """The GIF search for the carousel: a nonchalant, worn-out moment from a movie or
    show, none used lately, or None for an event too serious for one."""
    try:
        event = _first_event(batch_id)
        if event is None:
            return None
        recent = _recent_gif_searches()
        workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
        try:
            (Path(workdir) / "event.json").write_text(json.dumps(event, ensure_ascii=False))
            (Path(workdir) / "recent.json").write_text(json.dumps(recent, ensure_ascii=False))
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
    _remember_gif_search(recent, query)
    return GifComment(query, lambda screenshot, boxes: pick_gif(event, query, screenshot, boxes))


def _recent_gif_searches() -> list[str]:
    try:
        searches = json.loads(RECENT_GIFS_PATH.read_text())
    except (OSError, ValueError):
        return []
    return [str(search) for search in searches][-_CONTROL.gif_recent_searches :]


def _remember_gif_search(recent: list[str], query: str) -> None:
    try:
        RECENT_GIFS_PATH.parent.mkdir(parents=True, exist_ok=True)
        RECENT_GIFS_PATH.write_text(
            json.dumps([*recent, query][-_CONTROL.gif_recent_searches :], ensure_ascii=False)
        )
    except OSError:
        log.warning("Could not remember the GIF search %r", query, exc_info=True)


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


_HANDLE = re.compile(r"^[a-z0-9._]{1,30}$")


def slide_tags(batch_id: str) -> list[SlideTag]:
    """The club to tag on each event slide: the event's Instagram account, counting
    slides from the cover (0), as the carousel was posted. Our own accounts are never
    tagged."""
    try:
        rows = (
            get_sb()
            .table(INSTAGRAM_PUBLISH_ITEMS)
            .select("position,event:events(ig_handle)")
            .eq("batch_id", str(batch_id))
            .order("position")
            .execute()
        ).data or []
    except Exception:
        # The tags are a nice extra; they never hold up the song.
        log.warning("Could not read the clubs of Instagram batch %s", batch_id, exc_info=True)
        return []
    tags = []
    for slide, row in enumerate(rows, start=1):
        handle = ((row.get("event") or {}).get("ig_handle") or "").strip().lstrip("@").lower()
        if _HANDLE.fullmatch(handle) and not handle.startswith("wat2do"):
            tags.append(SlideTag(slide, handle))
    return tags


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
