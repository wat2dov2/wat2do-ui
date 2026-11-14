"""Judge each lead's club from its events, and pitch the clubs that are a fit.

Claude reads one club's newest events (``pitch_prompt.md``) and decides whether
students would come out for them; for a club that is a fit it writes the video
script the admin records and the personal email sent with the video. Each script
opens with a hook in one style from ``hooks.md``, the same style for a lead every
time, so scripts across clubs do not all open the same way. Only leads at
the control box's ``pitch_schools`` are pitched, and only fit leads reach the admin
Outreach page. A club judged not a fit is judged again after ``pitch_recheck_days``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from core.controlbox import controlbox
from schemas.outreach import Pitch
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.outreach import service

log = logging.getLogger(__name__)
CONTROL = controlbox.outreach
PROMPT = (Path(__file__).with_name("pitch_prompt.md")).read_text()
# Each "### " section of hooks.md is one hook style; its preamble is for people only.
HOOK_STYLES = [
    "### " + style.strip()
    for style in (Path(__file__).with_name("hooks.md")).read_text().split("\n### ")[1:]
]
WORKDIR_PREFIX = "wat2do-pitch-"
_TOOLS = ("Read",)
_ALLOWED_TOOLS = ("Read(./**)",)
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "fit": {"type": "boolean"},
        "reason": {"type": "string"},
        "script": {"type": "string"},
        "email_subject": {"type": "string"},
        "email_body": {"type": "string"},
    },
    "required": ["fit", "reason", "script", "email_subject", "email_body"],
    "additionalProperties": False,
}


def write_pitches(schools: list[str] | None = None, limit: int | None = None) -> dict[str, int]:
    """Judge and pitch the leads due at ``schools`` (the control box's by default)."""
    remove_leftovers(WORKDIR_PREFIX)
    leads = service.unpitched(
        schools or CONTROL.pitch_schools,
        CONTROL.pitches_per_sweep if limit is None else limit,
        recheck_before=datetime.now(UTC) - timedelta(days=CONTROL.pitch_recheck_days),
        event_limit=CONTROL.pitch_event_limit,
    )
    with ThreadPoolExecutor(max_workers=CONTROL.parallel_agents) as pool:
        pitches = list(pool.map(_pitch_safely, leads))
    for lead, pitch in zip(leads, pitches, strict=True):
        if pitch is not None:
            service.save_pitch(lead["lead_id"], pitch)
    written = [pitch for pitch in pitches if pitch is not None]
    fit = sum(pitch.fit for pitch in written)
    log.info("Outreach pitched %d leads, %d a fit", len(written), fit)
    return {
        "pitch_fit": fit,
        "pitch_not_fit": len(written) - fit,
        "pitch_failed": len(leads) - len(written),
    }


def _pitch_safely(lead: dict[str, Any]) -> Pitch | None:
    """The lead's pitch, or None when Claude failed or wrote one that breaks the rules."""
    try:
        return pitch(lead)
    except ClaudeCodeError:
        log.exception("Outreach pitch failed for lead %s", lead["lead_id"])
        return None


def pitch(lead: dict[str, Any]) -> Pitch | None:
    """Claude's verdict on one lead's club, with its script and email when it is a fit."""
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / "club.json").write_text(json.dumps(_club(lead), ensure_ascii=False))
        answer = run_agent(
            _prompt(lead),
            workdir=workdir,
            model=CONTROL.pitch_model,
            tools=_TOOLS,
            allowed_tools=_ALLOWED_TOOLS,
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.pitch_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    try:
        return Pitch.model_validate(answer)
    except ValidationError as error:
        log.warning("Outreach pitch for lead %s broke the rules: %s", lead["lead_id"], error)
        return None


def _club(lead: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": lead["club_name"],
        "instagram": lead["ig"],
        "website": lead["club_page"],
        "categories": lead["categories"] or [],
        "events": lead["events"],
    }


def _hook_style(lead_id: str) -> str:
    """The hook style for this lead's script, always the same one for the same lead."""
    digest = hashlib.sha256(str(lead_id).encode()).digest()
    return HOOK_STYLES[int.from_bytes(digest[:8]) % len(HOOK_STYLES)]


def _prompt(lead: dict[str, Any]) -> str:
    # The hook style goes in first, so the keys below are filled inside it too.
    values = {
        "hook_style": _hook_style(lead["lead_id"]),
        "sender_name": CONTROL.sender_name,
        "school_name": lead["school_name"],
        "qr_reimbursement_dollars": str(CONTROL.qr_reimbursement_dollars),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt
