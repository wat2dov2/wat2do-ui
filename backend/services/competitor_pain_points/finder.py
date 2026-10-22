"""Sweep the public web for complaints about each competitor with Claude Haiku.

Each competitor gets one agent per configured lane (Reddit, app stores and so
on), all sharing one pool, so the search fans out instead of one agent
covering every site. While they run, X posts are read one competitor at a time
in Safari (``x_browser``), since X shows nothing logged out, and an X agent
picks out the complaints among them. Agents have no secrets or accounts of
their own. Their findings are validated, links outside the reported source's
hosts are dropped as likely invented, and new links are stored for the admin
page. Nothing is ever posted.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from pydantic import ValidationError

from core.controlbox import controlbox
from schemas.competitor_pain_point import FoundPainPoint
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.competitor_pain_points import service, x_browser

log = logging.getLogger(__name__)
CONTROL = controlbox.competitor_pain_points
PROMPT = (Path(__file__).with_name("prompt.md")).read_text()
X_PROMPT = (Path(__file__).with_name("x_prompt.md")).read_text()
REPORT = (Path(__file__).with_name("report.md")).read_text()
X_LANE = "x"
WORKDIR_PREFIX = "wat2do-pain-points-"
_PAGE_SHARED_SOURCES = frozenset({"app_store", "google_play"})
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "source": {"type": "string", "enum": list(CONTROL.sources)},
                    "author": {"type": "string"},
                    "quote": {"type": "string"},
                    "pain_point": {"type": "string"},
                    "audience": {"type": "string", "enum": ["organizer", "attendee", "other"]},
                    "posted_at": {"type": ["string", "null"]},
                },
                "required": ["url", "source", "author", "quote", "pain_point", "audience"],
            },
        }
    },
    "required": ["findings"],
}


def sweep() -> dict[str, Any]:
    """Search every competitor's lanes in parallel and store what is new."""
    remove_leftovers(WORKDIR_PREFIX)
    known = service.recent_urls(CONTROL.known_urls_in_prompt)
    with ThreadPoolExecutor(max_workers=CONTROL.parallel_agents) as pool:
        searches = {
            (competitor, lane): pool.submit(_find_safely, competitor, lane, known, [])
            for competitor in CONTROL.competitors
            for lane in CONTROL.lanes
        }
        # Safari is one shared browser, so X is read one competitor at a time
        # while the web lanes already run.
        for competitor in CONTROL.competitors:
            if posts := _x_posts(competitor):
                searches[competitor, X_LANE] = pool.submit(
                    _find_safely, competitor, X_LANE, known, posts
                )
        found = {search: future.result() for search, future in searches.items()}
    failed = sorted(f"{c}/{lane}" for (c, lane), findings in found.items() if findings is None)
    unique = {f.url: f for findings in found.values() if findings for f in findings}
    return {"saved": service.save_findings(list(unique.values())), "failed": failed}


def _x_posts(competitor: str) -> list[dict[str, Any]]:
    try:
        return x_browser.read_posts(
            CONTROL.x_names.get(competitor, CONTROL.competitors[competitor])
        )
    except x_browser.XUnavailable as exc:
        log.warning("Skipping X for %s: %s", competitor, exc)
        return []


def _find_safely(
    competitor: str, lane: str, known: list[str], x_posts: list[dict[str, Any]]
) -> list[FoundPainPoint] | None:
    try:
        return find(competitor, lane, known, x_posts)
    except ClaudeCodeError:
        log.exception("Pain point sweep failed for %s/%s", competitor, lane)
        return None


def find(
    competitor: str, lane: str, known: list[str], x_posts: list[dict[str, Any]]
) -> list[FoundPainPoint]:
    """One lane's complaints about a competitor, checked; links already stored are left out.

    The X lane only reads ``x_posts``; every other lane searches the web.
    """
    tools = ("Read",) if lane == X_LANE else ("WebSearch", "WebFetch")
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        if lane == X_LANE:
            (Path(workdir) / "x_posts.json").write_text(json.dumps(x_posts, ensure_ascii=False))
        answer = run_agent(
            _prompt(competitor, lane, known),
            workdir=workdir,
            model=CONTROL.model,
            tools=tools,
            allowed_tools=tuple("Read(./**)" if tool == "Read" else tool for tool in tools),
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.agent_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    findings = []
    seen = set(known)
    reported = answer.get("findings") or []
    for item in reported[: CONTROL.findings_per_search]:
        try:
            finding = FoundPainPoint.model_validate({**item, "competitor": competitor})
        except (ValidationError, TypeError):
            continue
        finding = _with_review_anchor(finding)
        if finding.url in seen or not _plausible(finding):
            continue
        seen.add(finding.url)
        findings.append(finding)
    log.info(
        "Pain point sweep for %s/%s: %d reported, %d new",
        competitor,
        lane,
        len(reported),
        len(findings),
    )
    return findings


def _prompt(competitor: str, lane: str, known: list[str]) -> str:
    # Pieces that hold placeholders of their own go in first.
    values = {
        "report": REPORT,
        "lane": CONTROL.lanes.get(lane, ""),
        "competitor_name": CONTROL.competitors[competitor],
        "competitor_about": CONTROL.about[competitor],
        "lookback_days": str(CONTROL.lookback_days),
        "today": datetime.now(UTC).date().isoformat(),
        "sources": ", ".join(f"`{source}`" for source in CONTROL.sources),
        "known_urls": json.dumps(known),
        "limit": str(CONTROL.findings_per_search),
    }
    prompt = X_PROMPT if lane == X_LANE else PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _with_review_anchor(finding: FoundPainPoint) -> FoundPainPoint:
    """App store reviews share their app's page, so the quote keeps each one's link unique."""
    if finding.source not in _PAGE_SHARED_SOURCES or "#" in finding.url:
        return finding
    digest = hashlib.sha1(finding.quote.encode()).hexdigest()[:12]
    return finding.model_copy(update={"url": f"{finding.url}#review-{digest}"})


def _plausible(finding: FoundPainPoint) -> bool:
    """The link must belong to the source it claims, and not be a bare search page."""
    parts = urlsplit(finding.url)
    host = (parts.hostname or "").lower()
    hosts = CONTROL.sources.get(finding.source)
    if hosts is None or not host or parts.path in ("", "/") or "/search" in parts.path:
        return False
    return not hosts or any(host == h or host.endswith(f".{h}") for h in hosts)
