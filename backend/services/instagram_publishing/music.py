"""Songs for published carousels, added on the Mac from the Instagram app.

Admins keep a list of songs, typed loosely. Some minutes after a carousel
publishes, ``add_pending_music`` opens the live post on the emulator, likes and
reposts it, and tries the songs in random order: Instagram's music search finds candidates and Claude
Haiku picks the track the admin meant, or none so the next song is tried. A song
marked Asian or K-pop is tried only at the control box's ``asian_song_schools``.
"""

from __future__ import annotations

import json
import logging
import random
import shutil
import tempfile
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from core.constants import (
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_MUSIC_ADDED,
    INSTAGRAM_MUSIC_FAILED,
    INSTAGRAM_MUSIC_PENDING,
)
from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    INSTAGRAM_PUBLISHING_NOT_CONFIGURED,
    INSTAGRAM_SONG_EXISTS,
    INSTAGRAM_SONG_NOT_FOUND,
)
from core.exceptions import ConflictError, NotFoundError
from core.tables import INSTAGRAM_PUBLISH_BATCHES, INSTAGRAM_PUBLISHING_ACCOUNTS, INSTAGRAM_SONGS
from services import school_service
from services.claude_code import ClaudeCodeError, run_agent
from services.instagram_emulator.audio import SongNotFound, finish_post

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
WORKDIR_PREFIX = "wat2do-music-"
PROMPT = (Path(__file__).parent / "music_prompt.md").read_text()

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


def add_song(query: str, *, asian_campuses_only: bool = False) -> dict[str, Any]:
    query = " ".join(query.split())
    if any(song["query"].casefold() == query.casefold() for song in list_songs()):
        raise ConflictError(INSTAGRAM_SONG_EXISTS)
    response = (
        get_sb()
        .table(INSTAGRAM_SONGS)
        .insert({"query": query, "asian_campuses_only": asian_campuses_only})
        .execute()
    )
    return response.data[0]


def delete_song(song_id: UUID) -> None:
    response = get_sb().table(INSTAGRAM_SONGS).delete().eq("id", str(song_id)).execute()
    if not response.data:
        raise NotFoundError(INSTAGRAM_SONG_NOT_FOUND)


def add_pending_music(now: datetime | None = None) -> dict[str, int]:
    """Add a song to every carousel that has waited long enough since it published."""
    now = now or datetime.now(timezone.utc)
    songs = list_songs()
    if not songs:
        return {}
    outcomes: dict[str, int] = {}
    for batch in _pending_batches(now):
        playable = _songs_for(batch["school"], songs)
        if not playable:
            continue
        outcome = _add_music(batch, random.sample(playable, len(playable)))
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
        .select(
            f"id,account_key,permalink,music_attempts,updated_at,{school_service.SCHOOL_SLUG_EMBED}"
        )
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


def _add_music(batch: dict[str, Any], songs: Sequence[str]) -> str:
    attempts = int(batch["music_attempts"]) + 1
    try:
        added = finish_post(
            batch["school"],
            _username(batch["account_key"]),
            batch["permalink"],
            songs,
            choose_track,
        )
    except SongNotFound as exc:
        _record(batch["id"], INSTAGRAM_MUSIC_FAILED, attempts, error=str(exc))
        return INSTAGRAM_MUSIC_FAILED
    except Exception as exc:
        log.exception("Adding music to Instagram batch %s failed", batch["id"])
        final = attempts >= _CONTROL.music_attempts
        status = INSTAGRAM_MUSIC_FAILED if final else INSTAGRAM_MUSIC_PENDING
        _record(batch["id"], status, attempts, error=str(exc)[:500])
        return status
    _record(batch["id"], INSTAGRAM_MUSIC_ADDED, attempts, track=added.track)
    return INSTAGRAM_MUSIC_ADDED


def choose_track(query: str, tracks: Sequence[str]) -> int | None:
    """The index of the track the admin meant by ``query``, or None when none is it."""
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / "tracks.json").write_text(json.dumps(list(tracks), ensure_ascii=False))
        answer = run_agent(
            PROMPT.replace("{{query}}", query),
            workdir=workdir,
            model=_CONTROL.music_model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=_CONTROL.music_agent_timeout_seconds,
        )
    except ClaudeCodeError:
        log.warning("The track picker did not answer for one song")
        return None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    index = answer.get("index")
    return index if isinstance(index, int) and 0 <= index < len(tracks) else None


def _username(account_key: str) -> str:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select("instagram_username")
        .eq("account_key", account_key)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise NotFoundError(INSTAGRAM_PUBLISHING_NOT_CONFIGURED)
    return str(response.data[0]["instagram_username"])


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
