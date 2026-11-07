"""Score accounts waiting for review from their newest posts, read logged out.

Each account's profile embed is read the way a logged-out browser loads it, spaced
out because the Mac's ingestion reads share the IP, and stored so the admin sees the
same posts the scorer judged. Claude scores a school's accounts a batch at a time.
A sign of throttling stops the run; the rest are scored next time.

Each score decides the account right away: approve verdicts, and review verdicts that
posted within ``review_approve_days``, are approved; a profile that could not be read
is approved only when its handle or name names the school (the follow itself then
shows whether it exists); everything else is rejected. Rejected accounts that posted
within the last year are read and scored again every ``recheck_days``.
"""

from __future__ import annotations

import json
import logging
import random
import shutil
import tempfile
import time
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from services.claude_code import ClaudeCodeError, run_agent
from services.ingestion.instagram_fetch import FetchBlocked, fetch_profile
from services.instagram_follow import candidates
from services.instagram_follow.crawl import search_terms

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_follow
PROMPT = (Path(__file__).parent / "prompt.md").read_text()
WORKDIR_PREFIX = "wat2do-follow-scores-"
VERDICTS = ("approve", "review", "reject")

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "handle": {"type": "string"},
                    "score": {"type": "integer", "minimum": 0, "maximum": 100},
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "reason": {"type": "string"},
                },
                "required": ["handle", "score", "verdict", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["scores"],
    "additionalProperties": False,
}


def score_pending(limit: int = 500) -> dict[str, int]:
    """Read and score up to ``limit`` unscored accounts; returns how many were scored."""
    try:
        candidates.requeue_for_recheck(CONTROL.recheck_batch_size)
    except Exception:
        log.exception("Could not queue rejected accounts for a recheck")
    rows = sorted(candidates.unscored(limit), key=lambda row: row["school"] or "")
    scored = 0
    try:
        for school, group in groupby(rows, key=lambda row: row["school"]):
            batch: list[dict[str, Any]] = []
            for row in group:
                batch.append({**row, "profile": _read(row["handle"])})
                if len(batch) == CONTROL.score_batch_size:
                    scored += _score(school, batch)
                    batch = []
            if batch:
                scored += _score(school, batch)
    except FetchBlocked as exc:
        log.warning("Follow scoring stopped: %s", exc)
        return {"scored": scored, "stopped": 1}
    return {"scored": scored}


def _read(handle: str) -> dict[str, Any]:
    time.sleep(
        random.uniform(
            CONTROL.profile_read_delay_min_seconds, CONTROL.profile_read_delay_max_seconds
        )
    )
    return fetch_profile(handle)


def _score(school: str, batch: list[dict[str, Any]]) -> int:
    scores = _ask(school, batch)
    for row in batch:
        score = scores.get(row["handle"])
        candidates.save_profile(row["id"], row["profile"], score)
        if score is not None:
            candidates.auto_decide(row["id"], decision(school, row, row["profile"], score))
    return sum(row["handle"] in scores for row in batch)


def decision(
    school: str, row: dict[str, Any], profile: dict[str, Any], score: dict[str, Any]
) -> str:
    """Approved or rejected, from the score and what the read saw."""
    if score["verdict"] == "approve":
        return candidates.FOLLOW_CANDIDATE_APPROVED
    if profile["read"] == "failed":
        text = f"{row['handle']} {profile.get('name') or row.get('name') or ''}".casefold()
        names_school = any(term.casefold() in text for term in search_terms(school))
        if score["verdict"] == "review" and names_school:
            return candidates.FOLLOW_CANDIDATE_APPROVED
        return candidates.FOLLOW_CANDIDATE_REJECTED
    posts = profile.get("posts") or []
    if score["verdict"] == "review" and posts:
        quiet = datetime.now(timezone.utc) - datetime.fromisoformat(posts[0]["posted_at"])
        if quiet.days <= CONTROL.review_approve_days:
            return candidates.FOLLOW_CANDIDATE_APPROVED
    return candidates.FOLLOW_CANDIDATE_REJECTED


def _ask(school: str, batch: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        (Path(workdir) / "accounts.json").write_text(
            json.dumps([_packet(row) for row in batch], ensure_ascii=False)
        )
        answer = run_agent(
            PROMPT.replace("{{school}}", school),
            workdir=workdir,
            model=CONTROL.model,
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.agent_timeout_seconds,
        )
    except ClaudeCodeError:
        log.warning("The follow scorer did not answer for %s", school)
        return {}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    handles = {row["handle"] for row in batch}
    return {
        entry["handle"]: entry
        for entry in answer.get("scores") or []
        if entry.get("handle") in handles and entry.get("verdict") in VERDICTS
    }


def _packet(row: dict[str, Any]) -> dict[str, Any]:
    profile = row["profile"]
    posts = profile.get("posts") or []
    newest = posts[0]["posted_at"] if posts else None
    return {
        "handle": row["handle"],
        "name": profile.get("name") or row.get("name"),
        "read": profile["read"],
        "followers_count": profile.get("followers_count"),
        "posts_count": profile.get("posts_count"),
        "is_private": profile.get("is_private"),
        "days_since_post": (datetime.now(timezone.utc) - datetime.fromisoformat(newest)).days
        if newest
        else None,
        "posts": [{key: post[key] for key in ("posted_at", "caption", "url")} for post in posts],
    }
