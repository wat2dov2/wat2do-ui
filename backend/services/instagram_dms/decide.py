"""Decide how a school account answers one DM thread, with checks around the model."""

from __future__ import annotations

import json
import random
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from core.controlbox import controlbox
from services import club_service
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
        "reason": {"type": "string"},
    },
    "required": ["outcome", "media_url", "reason"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class DmDecision:
    outcome: Outcome
    media_url: str | None = None
    reply: str = ""
    done_reply: str = ""
    reason: str = ""


IGNORE = DmDecision("ignore")


def decide(
    thread: list[dict[str, Any]], *, account: str, school: str, school_name: str
) -> DmDecision:
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
    return checked(answer, thread, school=school)


def checked(answer: dict[str, Any], thread: list[dict[str, Any]], *, school: str) -> DmDecision:
    """The model only proposes; code decides whether a stranger's message may act at all.

    A message can be written to trick the model, so every action needs proof from the
    thread itself: the post was shared by its own owner, and a story repost also needs
    that owner to be a club Wat2Do already knows at this school. Replies never come from
    the model, so nothing a message says can end up in our answer.
    """
    reason = " ".join(str(answer.get("reason") or "").split())[:200]
    outcome = answer.get("outcome")
    if outcome not in ("story_repost", "add_to_post"):
        return DmDecision("ignore", reason=reason)
    media_url = answer.get("media_url")
    owners = {
        _handle(item.get("shared_owner"))
        for item in thread
        if item.get("from") == "them"
        and item.get("shared_url") == media_url
        and _handle(item.get("sender"))
        and _handle(item.get("shared_owner")) == _handle(item.get("sender"))
    }
    if not media_url or len(owners) != 1:
        return DmDecision("ignore", reason="Requested post was not shared by its own owner")
    owner = owners.pop()
    if (
        outcome == "story_repost"
        and club_service.lookup_club_by_school_and_ig(school, owner) is None
    ):
        return DmDecision("ignore", reason=f"@{owner} is not a known club at this school")
    return DmDecision(
        outcome,
        media_url=media_url,
        reply=random.choice(CONTROL.replies),
        done_reply=random.choice(CONTROL.done_replies) if outcome == "story_repost" else "",
        reason=reason,
    )


def _handle(value: object) -> str:
    return str(value or "").strip().lstrip("@").casefold()


def _prompt(account: str, school_name: str) -> str:
    values = {
        "account": account,
        "school_name": school_name,
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt
