"""Find the email of every unclaimed club with listings, once a day.

Each sweep first takes the clubs it has not seen yet, busiest first, and reads the
email printed on each club's own page. An address the page shows for more than one
club, or already given to another club, belongs to the directory, not the club, so it
is never used. Clubs still without an email then get a Claude research agent, a few at
a time; code keeps an address only when it is printed on the page the agent cites, so
an invented one never reaches the admin page. Nothing is ever sent: an admin sends the
email from Gmail.
"""

from __future__ import annotations

import logging
import re
import shutil
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from html import unescape
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from core.controlbox import controlbox
from schemas.outreach import FoundClubEmail
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.outreach import service

log = logging.getLogger(__name__)
CONTROL = controlbox.outreach
PROMPT = (Path(__file__).with_name("prompt.md")).read_text()
WORKDIR_PREFIX = "wat2do-outreach-"
_TOOLS = ("WebSearch", "WebFetch")
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "email": {"type": ["string", "null"]},
        "source_url": {"type": ["string", "null"]},
    },
    "required": ["email", "source_url"],
}
_EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}")
# Addresses nobody reads, and image names that look like addresses.
_UNUSABLE = re.compile(
    r"^(?:no-?reply|do-?not-?reply|mailer-daemon)@|\.(?:png|jpe?g|gif|webp|svg)$"
)
# Pages often hide addresses from scrapers as "name [at] host [dot] ca".
_OBFUSCATED_AT = re.compile(r"\s*[\[(]\s*at\s*[\])]\s*|\s+at\s+", re.IGNORECASE)
_OBFUSCATED_DOT = re.compile(r"\s*[\[(]\s*dot\s*[\])]\s*", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


def sweep() -> dict[str, Any]:
    """Read new clubs' pages, research the clubs still without an email, and store both."""
    remove_leftovers(WORKDIR_PREFIX)
    claimed = service.mark_claimed()
    taken = service.emails_in_use()
    page_emails = _search_club_pages(service.new_clubs(CONTROL.clubs_per_sweep), taken)
    research = service.clubs_to_research(
        CONTROL.research_per_sweep,
        searched_before=datetime.now(UTC) - timedelta(days=CONTROL.research_retry_days),
    )
    with ThreadPoolExecutor(max_workers=CONTROL.parallel_agents) as pool:
        answers = list(pool.map(_research_safely, research))
    research_emails, failed = 0, 0
    for club, found in zip(research, answers, strict=True):
        if found is False:
            failed += 1
            continue
        if found is not None and found.email in taken:
            found = None
        if found is not None:
            taken.add(found.email)
            research_emails += 1
        service.save_research(club["club_id"], found)
    return {
        "claimed": claimed,
        "page_emails": page_emails,
        "researched": len(research) - failed,
        "research_emails": research_emails,
        "research_failed": failed,
    }


def _search_club_pages(clubs: list[dict[str, Any]], taken: set[str]) -> int:
    """Store a lead for every new club, with the one address its page shows as its own."""
    with ThreadPoolExecutor(max_workers=CONTROL.page_fetch_concurrency) as pool:
        found = list(pool.map(lambda club: _page_emails(club.get("club_page")), clubs))
    # A directory prints its own address on every club's page.
    shared = Counter(email for emails in found for email in set(emails))
    saved = 0
    for club, emails in zip(clubs, found, strict=True):
        own = next((email for email in emails if shared[email] == 1 and email not in taken), None)
        email = FoundClubEmail(email=own, source_url=club["club_page"]) if own else None
        if email is not None:
            taken.add(email.email)
            saved += 1
        service.save_page_search(club["club_id"], email)
    log.info("Outreach read %d club pages, %d with the club's email", len(clubs), saved)
    return saved


def _page_emails(url: str | None) -> list[str]:
    """Addresses the page prints, in the order they appear."""
    if not url or not url.startswith("https://") or "instagram.com" in url:
        return []
    page = _page_text(url)
    if page is None:
        return []
    return [email for email in dict.fromkeys(_EMAIL.findall(page)) if not _UNUSABLE.search(email)]


def _research_safely(club: dict[str, Any]) -> FoundClubEmail | None | bool:
    """The agent's verified answer, None when it found nothing, False when it failed."""
    try:
        return research(club)
    except ClaudeCodeError:
        log.exception("Outreach research failed for club %s", club["club_id"])
        return False


def research(club: dict[str, Any]) -> FoundClubEmail | None:
    """One club's email from the public web, checked against the page it came from."""
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        answer = run_agent(
            _prompt(club),
            workdir=workdir,
            model=CONTROL.model,
            tools=_TOOLS,
            allowed_tools=_TOOLS,
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.agent_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    try:
        found = FoundClubEmail.model_validate(answer)
    except (ValidationError, TypeError):
        return None
    if _UNUSABLE.search(found.email) or found.email not in _page_with_addresses(found.source_url):
        return None
    return found


def _prompt(club: dict[str, Any]) -> str:
    values = {
        "club_name": club["club_name"],
        "school_name": club["school_name"],
        "club_page": club.get("club_page") or "none listed",
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _page_with_addresses(url: str) -> str:
    """The page as text with spelled-out addresses rejoined, or empty when unreadable."""
    page = _page_text(url)
    if page is None:
        return ""
    # A mailto link keeps the address in markup; visible text may spell it out.
    return page + " " + _OBFUSCATED_DOT.sub(".", _OBFUSCATED_AT.sub("@", _TAGS.sub(" ", page)))


def _page_text(url: str) -> str | None:
    try:
        response = httpx.get(
            url,
            timeout=CONTROL.page_fetch_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Wat2Do outreach research)"},
        )
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    return unescape(response.text).lower()
