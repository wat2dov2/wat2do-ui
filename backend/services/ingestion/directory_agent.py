"""Let Haiku directory agents read the official school event directories.

Each source gets one agent. It reads the downloaded listing, opens event pages
itself, skips what was already handled or is already listed, and reports
finished event and position details. Those become ``ready`` rows in the
ingestion queue for the processor to reconcile; pages that are not events are
remembered as ``not_event`` so no later run looks at them again.
"""

from __future__ import annotations

import fcntl
import json
import logging
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from html import unescape
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

from core.database import get_sb
from core.tables import EVENT_DATES, INGESTION_ITEMS, POSITIONS
from schemas.directory_source import DirectorySource
from services import school_service
from services.claude_code import ClaudeCodeError, remove_leftovers, run_agent
from services.ingestion.agent import AgentError
from services.ingestion.directory import list_sources
from services.ingestion.items import CONTROL
from services.ingestion.processor import state_directory
from services.school_context import resolve_school_timezone

log = logging.getLogger(__name__)
PROMPT = Path(__file__).with_name("directory_prompt.md").read_text()
WORKDIR_PREFIX = "wat2do-directory-"
# Some WAFs reject a full browser user-agent from a non-browser HTTP client.
_USER_AGENT = "curl/8.7.1"
_DETAIL_FIELDS = ("title", "starts", "ends", "location", "host", "description", "image_url")
REPORT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["url", "verdict"],
                "properties": {
                    "url": {"type": "string"},
                    "verdict": {
                        "enum": ["event", "position", "changed", "already_listed", "not_event"]
                    },
                    "title": {"type": "string"},
                    "starts": {"type": "array", "items": {"type": "string"}},
                    "ends": {"type": "array", "items": {"type": "string"}},
                    "location": {"type": "string"},
                    "host": {"type": "string"},
                    "description": {"type": "string"},
                    "image_url": {"type": "string"},
                },
            },
        }
    },
}


def scrape_directories() -> dict[str, int]:
    """Run one agent per directory source, a few at a time."""
    directory = state_directory()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "directories.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"busy": 1}
        remove_leftovers(WORKDIR_PREFIX)
        totals: Counter[str] = Counter()
        with ThreadPoolExecutor(CONTROL.directory_agents) as pool:
            for result in pool.map(_scrape_safely, list_sources()):
                totals.update(result)
    return dict(totals)


def _scrape_safely(source: DirectorySource) -> Counter[str]:
    try:
        return scrape_source(source)
    except Exception as exc:
        # One unreachable directory never stops the others.
        log.warning("Directory source %s failed (%s)", source.id, type(exc).__name__)
        return Counter(failed_sources=1)


def scrape_source(source: DirectorySource) -> Counter[str]:
    school = school_service.get_school(source.school)
    if school is None:
        raise AgentError("School is not registered")
    timezone = ZoneInfo(resolve_school_timezone(source.school))
    now = datetime.now(timezone)
    horizon = now + timedelta(days=CONTROL.directory_horizon_days)
    handled = _handled(source)
    listing = _download(source.url)
    with tempfile.TemporaryDirectory(prefix=WORKDIR_PREFIX) as workdir:
        folder = Path(workdir)
        listing_file = f"listing{_extension(listing)}"
        (folder / listing_file).write_bytes(listing)
        (folder / "handled.json").write_text(json.dumps(handled, indent=1))
        (folder / "listed.json").write_text(
            json.dumps(_listed(school.id, horizon, timezone), indent=1)
        )
        values = {
            "name": source.name,
            "school": source.school,
            "listing_url": source.url,
            "listing_file": listing_file,
            "today": now.strftime("%A %Y-%m-%d"),
            "timezone": timezone.key,
            "horizon_end": horizon.strftime("%A %Y-%m-%d"),
            "max_items": str(CONTROL.directory_items_per_run),
        }
        prompt = PROMPT
        for key, value in values.items():
            prompt = prompt.replace("{{" + key + "}}", value)
        reported = _run(prompt, workdir)
    return _save(source, school.id, reported, handled, listing)


def _download(url: str) -> bytes:
    with httpx.stream(
        "GET",
        url,
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
        timeout=CONTROL.fetch_timeout_seconds,
    ) as response:
        response.raise_for_status()
        body = bytearray()
        for chunk in response.iter_bytes():
            body += chunk
            if len(body) >= CONTROL.directory_listing_max_bytes:
                break
    return bytes(body[: CONTROL.directory_listing_max_bytes])


def _extension(listing: bytes) -> str:
    head = listing[:512].lstrip()
    if head.startswith(b"BEGIN:VCALENDAR"):
        return ".ics"
    if head[:1] in (b"{", b"["):
        return ".json"
    return ".html"


def _handled(source: DirectorySource) -> list[dict]:
    rows = (
        get_sb()
        .table(INGESTION_ITEMS)
        .select("source_url,status,post")
        .eq("directory_source_id", source.id)
        .execute()
        .data
        or []
    )
    return [
        {
            "url": row["source_url"],
            "status": row["status"],
            **((row.get("post") or {}).get("details") or {}),
        }
        for row in rows
    ]


def _listed(school_id: int, horizon: datetime, timezone: ZoneInfo) -> dict[str, list[dict]]:
    dates = (
        get_sb()
        .table(EVENT_DATES)
        .select("dtstart_utc,event:events!inner(id,title,location,club,source_url,school_id)")
        .eq("event.school_id", school_id)
        .gte("dtstart_utc", datetime.now(UTC).isoformat())
        .lte("dtstart_utc", horizon.astimezone(UTC).isoformat())
        .order("dtstart_utc")
        .execute()
        .data
        or []
    )
    positions = (
        get_sb()
        .table(POSITIONS)
        .select("id,title,source_url,club_id")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return {
        "events": [
            {
                **row["event"],
                "start": datetime.fromisoformat(row["dtstart_utc"])
                .astimezone(timezone)
                .strftime("%Y-%m-%dT%H:%M"),
            }
            for row in dates
        ],
        "positions": positions,
    }


def _run(prompt: str, workdir: str) -> list[dict]:
    try:
        answer = run_agent(
            prompt,
            workdir=workdir,
            model=CONTROL.model,
            tools=("Read", "Grep", "WebFetch"),
            allowed_tools=("Read(./**)", "Grep(./**)", "WebFetch"),
            schema=REPORT_SCHEMA,
            timeout=CONTROL.directory_model_timeout_seconds,
        )
    except ClaudeCodeError as exc:
        raise AgentError(f"Directory agent {exc}") from None
    reported = answer.get("items")
    if not isinstance(reported, list):
        raise AgentError("Directory agent gave no report")
    return [item for item in reported if isinstance(item, dict)]


def _save(
    source: DirectorySource,
    school_id: int,
    reported: list[dict],
    handled: list[dict],
    listing: bytes,
) -> Counter[str]:
    """Queue what the agent found; remember everything it decided about."""
    stats: Counter[str] = Counter()
    statuses = {row["url"]: row["status"] for row in handled}
    page = unescape(listing.decode("utf-8", "replace"))
    host = urlsplit(source.url).hostname or ""
    for item in reported[: CONTROL.directory_items_per_run]:
        url = str(item.get("url") or "").strip()
        verdict = item.get("verdict")
        if not _plausible(url, page, host):
            stats["invented_urls"] += 1
            continue
        row = {
            "source_url": url,
            "school_id": school_id,
            "source": "directory",
            "directory_source_id": source.id,
        }
        if verdict == "changed":
            if statuses.get(url) != "done":
                continue
            _update_ready(url, _post(url, item))
            stats["changed"] += 1
        elif url in statuses:
            continue
        elif verdict in ("event", "position"):
            _insert({**row, "status": "ready", "post": _post(url, item)})
            stats["queued"] += 1
        elif verdict == "already_listed":
            _insert({**row, "status": "done", "post": _post(url, item)})
            stats["already_listed"] += 1
        else:
            _insert({**row, "status": "not_event"})
            stats["not_events"] += 1
    return stats


def _plausible(url: str, page: str, listing_host: str) -> bool:
    """A reported URL must appear in the listing or live on the directory's own site."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    if url in page or url.rstrip("/") in page:
        return True
    site = ".".join(listing_host.split(".")[-2:])
    return parts.hostname == site or parts.hostname.endswith(f".{site}")


def _post(url: str, item: dict) -> dict:
    """The processor's view of a directory page: finished text plus its poster."""
    details = {field: item[field] for field in _DETAIL_FIELDS if item.get(field)}
    starts, ends = details.get("starts", []), details.get("ends", [])
    when = "; ".join(
        f"{start} to {ends[index]}" if index < len(ends) else start
        for index, start in enumerate(starts)
    )
    lines = [
        f"Kind: {item.get('verdict') if item.get('verdict') != 'changed' else 'event'}",
        f"Title: {details.get('title', '')}",
        f"When: {when}",
        f"Where: {details.get('location', '')}",
        f"Host: {details.get('host', '')}",
        f"Description: {details.get('description', '')}",
    ]
    return {
        "url": url,
        "text": "\n".join(lines),
        "images": [details["image_url"]] if details.get("image_url") else [],
        "details": details,
    }


def _insert(row: dict) -> None:
    get_sb().table(INGESTION_ITEMS).upsert(
        row, on_conflict="source_url", ignore_duplicates=True
    ).execute()


def _update_ready(url: str, post: dict) -> None:
    get_sb().table(INGESTION_ITEMS).update(
        {
            "status": "ready",
            "post": post,
            "attempts": 0,
            "claimed_until": None,
            "updated_at": datetime.now(UTC).isoformat(),
        }
    ).eq("source_url", url).eq("status", "done").execute()
