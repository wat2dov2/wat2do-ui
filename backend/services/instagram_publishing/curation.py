"""Claude curates each school's daily carousel draft; an admin still reviews and publishes it.

One Claude Code run per school reads that school's candidate packet and posters
from a private folder, then answers with its picks. This module validates the
answer through ``DraftSelection`` and saves it with ``save_review_draft``.
Claude gets only Read access to that folder and no application secrets.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError as PydanticValidationError

from core.controlbox import controlbox
from core.exceptions import ValidationError
from services import school_service
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.instagram_publishing.selection import DraftSelection
from services.instagram_publishing.service import list_draft_candidates, save_review_draft

log = logging.getLogger(__name__)

_CONTROL = controlbox.instagram_publishing
PROMPT = Path(__file__).with_name("curation_prompt.md").read_text()
WORKDIR_PREFIX = "wat2do-instagram-curation-"
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
    "required": ["picks", "cover_body", "caption_intro", "notes"],
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
        "cover_body": {"type": "string", "maxLength": _CONTROL.cover_body_character_limit},
        "caption_intro": {"type": "string", "maxLength": 2200},
        "notes": {"type": "string"},
    },
}


class CurationError(RuntimeError):
    pass


def curate_all() -> dict[str, int]:
    """Draft every school that has no draft for today yet."""
    remove_leftovers(WORKDIR_PREFIX)
    packets = [packet for packet in list_draft_candidates() if packet["status"] == "needs_review"]
    with ThreadPoolExecutor(max_workers=_CONTROL.curation_parallel_agents) as pool:
        outcomes = list(pool.map(_curate_safely, packets))
    return dict(Counter(outcomes))


def _curate_safely(packet: dict[str, Any]) -> str:
    try:
        return curate_school(packet)
    except Exception:
        log.exception("Instagram curation failed for %s", packet["account_key"])
        return "failed"


def curate_school(packet: dict[str, Any]) -> str:
    """Draft one school's carousel and return the save outcome."""
    if not packet["events"]:
        return _save(packet, {"picks": [], "cover_body": "", "caption_intro": None})
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        _write_packet(Path(workdir), packet)
        prompt = PROMPT
        for attempt in range(_CONTROL.curation_attempts):
            answer = _run(prompt, workdir)
            try:
                return _save(packet, answer)
            except (PydanticValidationError, ValidationError, ValueError) as exc:
                if attempt + 1 == _CONTROL.curation_attempts:
                    raise
                prompt = f"{PROMPT}\n\nYour previous answer was rejected; fix this and answer again:\n{exc}"
        raise CurationError("Instagram curation made no attempt")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _save(packet: dict[str, Any], answer: dict[str, Any]) -> str:
    selection = DraftSelection(
        account_key=packet["account_key"],
        window_end=packet["window_end"],
        caption_intro=(answer.get("caption_intro") or packet["caption_intro"]).strip(),
        cover_body=answer["cover_body"].strip(),
        picks=answer["picks"],
    )
    result = save_review_draft(selection)
    log.info(
        "Instagram draft %s: %s (%s)", packet["account_key"], result["outcome"], answer.get("notes")
    )
    return str(result["outcome"])


def _write_packet(workdir: Path, packet: dict[str, Any]) -> None:
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
                "excluded_clubs": packet["excluded_clubs"],
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
        response = httpx.get(url, timeout=_CONTROL.poster_timeout_seconds, follow_redirects=True)
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
            timeout=_CONTROL.poster_timeout_seconds,
        )
        source.unlink()
    except (httpx.HTTPError, OSError, subprocess.SubprocessError):
        log.warning("Poster unavailable for event %s", event_id)
        return None
    return f"posters/{path.name}"


def _run(prompt: str, workdir: str) -> dict[str, Any]:
    try:
        return run_agent(
            prompt,
            workdir=workdir,
            model=_CONTROL.curation_model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=_CONTROL.curation_timeout_seconds,
        )
    except ClaudeCodeError as exc:
        raise CurationError(f"Instagram curation agent {exc}") from None
