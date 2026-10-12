"""Claude curates each school's daily carousel draft; an admin still reviews and publishes it.

One Claude Code run per school reads that school's candidate packet and posters
from a private folder, then answers with its picks. This module validates the
answer through ``DraftSelection`` and saves it with ``save_review_draft``.
Claude gets only Read access to that folder and no application secrets.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from pydantic import ValidationError as PydanticValidationError

from core.controlbox import controlbox
from core.exceptions import ValidationError
from services import school_service
from services.ingestion.agent import claude_environment, remove_leftovers, remove_run_folder
from services.instagram_publishing.credentials import refresh_expiring_tokens
from services.instagram_publishing.selection import DraftSelection
from services.instagram_publishing.service import list_draft_candidates, save_review_draft

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
PROMPT = Path(__file__).with_name("curation_prompt.md").read_text()
WORKDIR_PREFIX = "wat2do-instagram-curation-"
_CHART_DATA = re.compile(
    r'<script type="application/json" id="serialized-server-data">(.*?)</script>', re.S
)
_EVENT_FIELDS = (
    "id",
    "title",
    "club",
    "ig_handle",
    "category",
    "description",
    "location",
    "dtstart_utc",
    "dtend_utc",
    "tz",
    "price",
    "food",
    "registration",
)

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["picks", "cover_body", "caption_intro", "song_number", "notes"],
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["event_id", "sticker_labels"],
                "properties": {
                    "event_id": {"type": "integer"},
                    "sticker_labels": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": _CONTROL.maximum_stickers_per_event,
                        "items": {"type": "string"},
                    },
                },
            },
        },
        "cover_body": {"type": "string", "maxLength": 280},
        "caption_intro": {"type": "string", "maxLength": 2200},
        "song_number": {"type": ["integer", "null"]},
        "notes": {"type": "string"},
    },
}


class CurationError(RuntimeError):
    pass


def curate_all() -> dict[str, int]:
    """Refresh tokens, then draft every school that has no draft for today yet."""
    remove_leftovers(WORKDIR_PREFIX)
    tokens = refresh_expiring_tokens()
    if tokens.get("failed"):
        log.warning("Instagram token refresh failed for %s accounts", tokens["failed"])
    packets = [packet for packet in list_draft_candidates() if packet["status"] == "needs_review"]
    charts = {
        chart_url: chart_tracks(chart_url)
        for chart_url in {packet["music_chart"]["url"] for packet in packets}
    }
    with ThreadPoolExecutor(max_workers=_CONTROL.curation_parallel_agents) as pool:
        outcomes = list(
            pool.map(
                lambda packet: _curate_safely(packet, charts[packet["music_chart"]["url"]]), packets
            )
        )
    return dict(Counter(outcomes))


def _curate_safely(packet: dict[str, Any], tracks: list[dict[str, str]] | None) -> str:
    try:
        return curate_school(packet, tracks)
    except Exception:
        log.exception("Instagram curation failed for %s", packet["account_key"])
        return "failed"


def curate_school(packet: dict[str, Any], tracks: list[dict[str, str]] | None) -> str:
    """Draft one school's carousel and return the save outcome."""
    songs = offered_songs(packet, tracks)
    if not packet["events"]:
        return _save(packet, {"picks": [], "cover_body": "", "caption_intro": None}, songs)
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        _write_packet(Path(workdir), packet, songs)
        prompt = PROMPT
        for attempt in range(_CONTROL.curation_attempts):
            answer = _run(prompt, workdir)
            try:
                return _save(packet, answer, songs)
            except (PydanticValidationError, ValidationError, ValueError) as exc:
                if attempt + 1 == _CONTROL.curation_attempts:
                    raise
                prompt = f"{PROMPT}\n\nYour previous answer was rejected; fix this and answer again:\n{exc}"
        raise CurationError("Instagram curation made no attempt")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        remove_run_folder(workdir)


def _save(packet: dict[str, Any], answer: dict[str, Any], songs: list[dict[str, Any]]) -> str:
    number = answer.get("song_number")
    if number is not None and not 0 <= number < len(songs):
        raise ValueError(f"song_number must be between 0 and {len(songs) - 1} or null")
    selection = DraftSelection(
        account_key=packet["account_key"],
        window_end=packet["window_end"],
        caption_intro=(answer.get("caption_intro") or packet["caption_intro"]).strip(),
        cover_body=answer["cover_body"].strip(),
        suggested_song=songs[number] if number is not None else None,
        picks=answer["picks"],
    )
    result = save_review_draft(selection)
    log.info(
        "Instagram draft %s: %s (%s)", packet["account_key"], result["outcome"], answer.get("notes")
    )
    return str(result["outcome"])


def offered_songs(
    packet: dict[str, Any], tracks: list[dict[str, str]] | None
) -> list[dict[str, Any]]:
    """Today's verified chart, or else the school's previously verified suggestions."""
    if tracks:
        today = datetime.now(ZoneInfo(_CONTROL.generation_timezone)).date().isoformat()
        chart = packet["music_chart"]
        return [
            {**track, "chart_name": chart["name"], "chart_url": chart["url"], "checked_on": today}
            for track in tracks
        ]
    return list(packet.get("recent_songs") or [])


def chart_tracks(chart_url: str) -> list[dict[str, str]] | None:
    """Read the chart's titles and artists from Apple Music's public page data."""
    try:
        response = httpx.get(
            chart_url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=_CONTROL.chart_timeout_seconds,
            follow_redirects=True,
        )
        response.raise_for_status()
        match = _CHART_DATA.search(response.text)
        data = json.loads(match.group(1)) if match else None
    except (httpx.HTTPError, ValueError):
        log.warning("Apple Music chart could not be read: %s", chart_url)
        return None
    tracks: list[dict[str, str]] = []
    _collect_tracks(data, tracks)
    unique = list({(track["title"], track["artist"]): track for track in tracks}.values())
    return unique or None


def _collect_tracks(node: Any, tracks: list[dict[str, str]]) -> None:
    if isinstance(node, dict):
        if isinstance(node.get("title"), str) and isinstance(node.get("artistName"), str):
            tracks.append({"title": node["title"], "artist": node["artistName"]})
        for value in node.values():
            _collect_tracks(value, tracks)
    elif isinstance(node, list):
        for value in node:
            _collect_tracks(value, tracks)


def _write_packet(workdir: Path, packet: dict[str, Any], songs: list[dict[str, Any]]) -> None:
    posters = workdir / "posters"
    posters.mkdir()
    events = []
    for event in packet["events"]:
        summary = {field: event.get(field) for field in _EVENT_FIELDS}
        summary["poster_file"] = _download_poster(
            event.get("source_image_url"), posters, event["id"]
        )
        events.append(summary)
    school = school_service.get_school(packet["account_key"])
    (workdir / "packet.json").write_text(
        json.dumps(
            {
                "school": packet["account_key"],
                "language": school.language if school else "en",
                "default_caption_intro": packet["caption_intro"],
                "events": events,
                "songs": [{"title": song["title"], "artist": song["artist"]} for song in songs],
                "recent_songs": [
                    {"title": song["title"], "artist": song["artist"]}
                    for song in packet.get("recent_songs") or []
                ],
            },
            ensure_ascii=False,
            indent=1,
        )
    )


def _download_poster(url: str | None, folder: Path, event_id: int) -> str | None:
    """Save a small JPEG of the poster for Claude to look at; None when there is none."""
    if not url or not url.startswith("http"):
        return None
    path = folder / f"{event_id}.jpg"
    try:
        response = httpx.get(url, timeout=_CONTROL.chart_timeout_seconds, follow_redirects=True)
        response.raise_for_status()
        source = folder / f"{event_id}.source"
        source.write_bytes(response.content)
        subprocess.run(
            [
                "sips",
                "-s",
                "format",
                "jpeg",
                "-Z",
                str(_CONTROL.curation_poster_pixels),
                str(source),
                "--out",
                str(path),
            ],
            check=True,
            capture_output=True,
            timeout=_CONTROL.chart_timeout_seconds,
        )
        source.unlink()
    except (httpx.HTTPError, OSError, subprocess.SubprocessError):
        log.warning("Poster unavailable for event %s", event_id)
        return None
    return f"posters/{path.name}"


def _run(prompt: str, workdir: str) -> dict[str, Any]:
    executable = shutil.which("claude")
    if executable is None:
        raise CurationError("Claude Code is not installed")
    try:
        result = subprocess.run(
            [
                executable,
                "-p",
                "--model",
                _CONTROL.curation_model,
                "--tools",
                "Read",
                "--allowedTools",
                "Read(./**)",
                "--permission-mode",
                "dontAsk",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--output-format",
                "json",
                "--json-schema",
                json.dumps(ANSWER_SCHEMA),
            ],
            input=prompt,
            cwd=workdir,
            env=claude_environment(),
            capture_output=True,
            text=True,
            timeout=_CONTROL.curation_timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CurationError(f"Instagram curation agent failed ({type(exc).__name__})") from None
    if result.returncode:
        raise CurationError(f"Instagram curation agent failed (exit {result.returncode})")
    try:
        answer = json.loads(result.stdout).get("structured_output")
    except (ValueError, AttributeError):
        answer = None
    if not isinstance(answer, dict):
        raise CurationError("Instagram curation agent gave no answer")
    return answer
