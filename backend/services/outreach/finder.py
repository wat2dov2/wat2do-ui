"""Research event organizers at every school with Claude Haiku, once a day.

Each school gets one agent per lead type (hackathons, ticketed events), all
sharing one pool. An agent searches the public web for upcoming events of its
kind, finds each organizer's published email, and writes the brief, video
script, email and follow-up for them. Agents have no secrets or accounts of their own. Code keeps
a lead only when its email is printed on the page the agent cites, so an
invented address never reaches the admin page. Nothing is ever sent: an admin
records the video and sends the email from Gmail.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from html import unescape
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from core.controlbox import controlbox
from schemas.outreach import FoundOutreachLead
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.outreach import service

log = logging.getLogger(__name__)
CONTROL = controlbox.outreach
PROMPT = (Path(__file__).with_name("prompt.md")).read_text()
WORKDIR_PREFIX = "wat2do-outreach-"
_TOOLS = ("WebSearch", "WebFetch")
_LEAD_FIELDS = {
    "event_name": {"type": "string"},
    "event_url": {"type": "string"},
    "event_date": {"type": ["string", "null"]},
    "organization": {"type": "string"},
    "contact_name": {"type": "string"},
    "contact_role": {"type": "string"},
    "email": {"type": "string"},
    "source_url": {"type": "string"},
    "context": {"type": "string"},
    "video_script": {"type": "string"},
    "email_subject": {"type": "string"},
    "email_body": {"type": "string"},
    "follow_up": {"type": "string"},
}
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "leads": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _LEAD_FIELDS,
                "required": [name for name in _LEAD_FIELDS if name != "event_date"],
            },
        }
    },
    "required": ["leads"],
}
# Pages often hide addresses from scrapers as "name [at] host [dot] ca".
_OBFUSCATED_AT = re.compile(r"\s*[\[(]\s*at\s*[\])]\s*|\s+at\s+", re.IGNORECASE)
_OBFUSCATED_DOT = re.compile(r"\s*[\[(]\s*dot\s*[\])]\s*", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


def sweep() -> dict[str, Any]:
    """Research every school for every lead type and store the organizers not seen before."""
    remove_leftovers(WORKDIR_PREFIX)
    schools = service.schools()
    known = service.known_emails(CONTROL.known_emails_in_prompt)
    with ThreadPoolExecutor(max_workers=CONTROL.parallel_agents) as pool:
        searches = {
            (school["slug"], lead_type): pool.submit(_find_safely, lead_type, school, known)
            # Lead types run in control box order, so the priority one covers every school first.
            for lead_type in CONTROL.lead_types
            for school in schools
        }
        found = {search: future.result() for search, future in searches.items()}
    ids = {school["slug"]: school["id"] for school in schools}
    saved = sum(
        service.save_leads(ids[slug], lead_type, leads)
        for (slug, lead_type), leads in found.items()
        if leads
    )
    failed = sorted(
        f"{slug}/{lead_type}" for (slug, lead_type), leads in found.items() if leads is None
    )
    return {"saved": saved, "failed": failed}


def _find_safely(
    lead_type: str, school: dict[str, Any], known: list[str]
) -> list[FoundOutreachLead] | None:
    try:
        return find(lead_type, school, known)
    except ClaudeCodeError:
        log.exception("Outreach research failed for %s/%s", school["slug"], lead_type)
        return None


def find(lead_type: str, school: dict[str, Any], known: list[str]) -> list[FoundOutreachLead]:
    """One school's organizers of one kind, each checked against the page it came from."""
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        answer = run_agent(
            _prompt(lead_type, school, known),
            workdir=workdir,
            model=CONTROL.model,
            tools=_TOOLS,
            allowed_tools=_TOOLS,
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.agent_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    leads: list[FoundOutreachLead] = []
    seen = {email.lower() for email in known}
    reported = answer.get("leads") or []
    for item in reported[: CONTROL.leads_per_search]:
        try:
            lead = FoundOutreachLead.model_validate(item)
        except (ValidationError, TypeError):
            continue
        if lead.email in seen or not _upcoming(lead) or not _email_on_page(lead):
            continue
        seen.add(lead.email)
        leads.append(lead)
    log.info(
        "Outreach research for %s/%s: %d reported, %d kept",
        school["slug"],
        lead_type,
        len(reported),
        len(leads),
    )
    return leads


def _prompt(lead_type: str, school: dict[str, Any], known: list[str]) -> str:
    values = {
        "school_name": school["name"],
        "sender_name": CONTROL.sender_name,
        "today": datetime.now(UTC).date().isoformat(),
        "offer": CONTROL.offer,
        "lead_type": CONTROL.lead_types[lead_type],
        "limit": str(CONTROL.leads_per_search),
        "known_emails": json.dumps(known),
        "submit_url": CONTROL.submit_url_template.replace("{school}", school["slug"]),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _upcoming(lead: FoundOutreachLead) -> bool:
    """An event already over is no reason to write to anyone."""
    return lead.event_date is None or lead.event_date >= date.today()


def _email_on_page(lead: FoundOutreachLead) -> bool:
    """The address must be printed on the page the agent says it read it on."""
    try:
        response = httpx.get(
            lead.source_url,
            timeout=CONTROL.page_fetch_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Wat2Do outreach research)"},
        )
    except httpx.HTTPError:
        return False
    if response.status_code >= 400:
        return False
    page = unescape(response.text).lower()
    # A mailto link keeps the address in markup; visible text may spell it out.
    text = _OBFUSCATED_DOT.sub(".", _OBFUSCATED_AT.sub("@", _TAGS.sub(" ", page)))
    return lead.email in page or lead.email in text
