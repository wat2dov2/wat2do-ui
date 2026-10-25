"""Decide how a school account answers one DM thread, with checks around the model."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

from core.controlbox import controlbox
from services.claude_code import ClaudeCodeError, run_agent

CONTROL = controlbox.instagram_dms
WORKDIR_PREFIX = "wat2do-dm-"
PROMPT = (Path(__file__).parent / "prompt.md").read_text()

Outcome = Literal["story_repost", "add_to_post", "reply", "ignore"]
_ACTIONS = ("story_repost", "add_to_post")

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": ["story_repost", "add_to_post", "reply", "ignore"]},
        "media_url": {"type": ["string", "null"]},
        "reply": {"type": ["string", "null"]},
        "reason": {"type": "string"},
    },
    "required": ["outcome", "media_url", "reply", "reason"],
    "additionalProperties": False,
}
# Any web address in a reply must be one of ours.
_ADDRESS = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}\S*", re.IGNORECASE)
_OUR_ADDRESS = re.compile(r"^(?:https?://)?(?:[a-z0-9-]+\.)?wat2do\.io(?:/\S*)?$", re.IGNORECASE)
# Long digit runs are phone numbers or codes, never something we need to say.
_DIGITS = re.compile(r"\d{5,}")
_PLAIN_QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'})


@dataclass(frozen=True)
class DmDecision:
    outcome: Outcome
    media_url: str | None = None
    reply: str = ""
    reason: str = ""


IGNORE = DmDecision("ignore")


def decide(
    thread: list[dict[str, Any]], *, account: str, school: str, school_name: str
) -> DmDecision:
    """The model reads the thread, picks an outcome and writes the reply; code checks both."""
    if not thread or thread[-1].get("from") != "them":
        # Nothing new from them, or we already answered last.
        return IGNORE
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / "thread.json").write_text(json.dumps(thread, ensure_ascii=False))
        answer = run_agent(
            _prompt(account, school, school_name),
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
    """The model only proposes; code decides whether a stranger's message may act at all.

    A message can be written to trick the model, so every action needs proof from the
    thread itself: the post was shared right here, and a post added to the site was shared
    by its own owner. Any account may get its post onto our story; the model judges
    whether the post is fit to share. The reply must pass ``safe_reply``, so nothing a
    message smuggles in can link, tag or leak anything.
    Anything that fails a check is not answered at all.
    """
    reason = " ".join(str(answer.get("reason") or "").split())[:200]
    outcome = answer.get("outcome")
    if outcome not in (*_ACTIONS, "reply"):
        return DmDecision("ignore", reason=reason)
    reply = safe_reply(answer.get("reply"))
    if reply is None:
        return DmDecision("ignore", reason="The reply did not pass the checks")
    if outcome == "reply":
        return DmDecision("reply", reply=reply, reason=reason)
    media_url = answer.get("media_url")
    shares = [
        item
        for item in thread
        if item.get("from") == "them"
        and item.get("shared_url") == media_url
        and _handle(item.get("sender"))
        and _handle(item.get("shared_owner"))
    ]
    if not media_url or not shares:
        return DmDecision("ignore", reason="Requested post was not shared in this thread")
    if outcome == "add_to_post" and not any(
        _handle(item["shared_owner"]) == _handle(item["sender"]) for item in shares
    ):
        return DmDecision("ignore", reason="Only a club's own post is added to the site")
    return DmDecision(outcome, media_url=media_url, reply=reply, reason=reason)


def safe_reply(text: object) -> str | None:
    """The reply as one line of plain text the emulator can type, or None if unsafe.

    Accents are folded to plain letters and anything else outside printable ASCII is
    dropped, since the emulator types through adb. A tag, an email address other than
    ours, a link to anywhere but Wat2Do, or a long number rejects the reply instead of
    being trimmed.
    """
    plain = str(text or "").translate(_PLAIN_QUOTES)
    folded = unicodedata.normalize("NFKD", plain).encode("ascii", "ignore").decode()
    reply = " ".join("".join(ch for ch in folded if ch.isprintable()).split())
    if not reply or len(reply) > CONTROL.reply_max_characters:
        return None
    if "@" in reply.replace(CONTROL.contact_email, "") or _DIGITS.search(reply):
        return None
    if any(not _OUR_ADDRESS.match(address.rstrip(".,!?)")) for address in _ADDRESS.findall(reply)):
        return None
    return reply


def _handle(value: object) -> str:
    return str(value or "").strip().lstrip("@").casefold()


def _prompt(account: str, school: str, school_name: str) -> str:
    values = {
        "account": account,
        "school_name": school_name,
        "school_url": f"https://{school}.wat2do.io",
        "contact_email": CONTROL.contact_email,
        "today": date.today().strftime("%A, %B %-d, %Y"),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt
