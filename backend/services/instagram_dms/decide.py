"""Decide how a school account answers one DM thread, with checks around the model."""

from __future__ import annotations

import json
import random
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from core.controlbox import controlbox
from services.claude_code import ClaudeCodeError, run_agent

CONTROL = controlbox.instagram_dms
WORKDIR_PREFIX = "wat2do-dm-"
PROMPT = (Path(__file__).parent / "prompt.md").read_text()

Outcome = Literal["story_repost", "add_to_post", "ignore"]

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": ["story_repost", "add_to_post", "ignore"]},
        "media_url": {"type": ["string", "null"]},
        "reply": {"type": "string"},
        "done_reply": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["outcome", "media_url", "reply", "done_reply", "reason"],
    "additionalProperties": False,
}

# Used only when the model's wording fails the checks below, so a valid request still
# gets a natural, varied answer instead of being dropped.
_FALLBACK_REPLIES = ("Sure!", "Of course!", "Sure thing!", "Yep, on it!")
_FALLBACK_DONE_REPLIES = ("Done!", "All set!", "Posted!", "Done :)")
_UNSAFE_REPLY = re.compile(r"https?://|www\.|@")


@dataclass(frozen=True)
class DmDecision:
    outcome: Outcome
    media_url: str | None = None
    reply: str = ""
    done_reply: str = ""
    reason: str = ""


IGNORE = DmDecision("ignore")


def decide(thread: list[dict[str, Any]], *, account: str, school_name: str) -> DmDecision:
    """One outcome for the club's latest messages; anything doubtful is ignored."""
    if not thread or thread[-1].get("from") != "them":
        # Nothing new from the club, or we already answered last.
        return IGNORE
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / "thread.json").write_text(json.dumps(thread, ensure_ascii=False))
        answer = run_agent(
            _prompt(account, school_name),
            workdir=workdir,
            model=CONTROL.model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.agent_timeout_seconds,
        )
    except ClaudeCodeError:
        return IGNORE
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return checked(answer, thread)


def checked(answer: dict[str, Any], thread: list[dict[str, Any]]) -> DmDecision:
    """Never trust the model's links or wording without checking them against the thread."""
    outcome = answer.get("outcome")
    if outcome not in ("story_repost", "add_to_post"):
        return DmDecision("ignore", reason=str(answer.get("reason") or "")[:200])
    shared = {
        item["shared_url"]
        for item in thread
        if item.get("from") == "them" and item.get("shared_url")
    }
    media_url = answer.get("media_url")
    if media_url not in shared:
        return DmDecision("ignore", reason="Requested post was not shared in the thread")
    return DmDecision(
        outcome,
        media_url=media_url,
        reply=_safe(answer.get("reply"), _FALLBACK_REPLIES),
        done_reply=_safe(answer.get("done_reply"), _FALLBACK_DONE_REPLIES)
        if outcome == "story_repost"
        else "",
        reason=str(answer.get("reason") or "")[:200],
    )


def _safe(text: object, fallbacks: tuple[str, ...]) -> str:
    value = " ".join(str(text or "").split())
    if not value or len(value) > CONTROL.reply_max_characters or _UNSAFE_REPLY.search(value):
        return random.choice(fallbacks)
    return value


def _prompt(account: str, school_name: str) -> str:
    values = {
        "account": account,
        "school_name": school_name,
        "reply_max_characters": str(CONTROL.reply_max_characters),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt
