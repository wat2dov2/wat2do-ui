"""Let Haiku ingest one captured source straight into events and positions.

The agent reads the source, inspects what is already listed, and writes the
result itself through a database login scoped to events and positions. Its
instructions live in ``prompt.md``; this module only prepares the source and
applies the side effects of what the agent changed.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

from core.config import settings
from core.constants import EVENT_CATEGORIES
from core.database import get_sb
from core.sanitize import normalize_scraped_text, parse_iso_datetime
from core.tables import EVENTS, POSITIONS
from services import school_service
from services.ingestion import changes
from services.ingestion.items import CONTROL
from services.school_context import (
    campus_season_prompt,
    current_semester_end,
    resolve_school_timezone,
)
from services.scraper.dedup import _extract_shortcode, existing_shortcodes, existing_urls
from services.scraper.extractor import EVENT_DISCOVERY_RULES
from services.scraper.image_uploader import (
    fetch_image,
    is_carousel_post,
    single_post_video_url,
    store_image,
    upload_video_from_url,
)
from services.scraper.org_resolve import resolve_club_for_scrape

log = logging.getLogger(__name__)
PROMPT = Path(__file__).with_name("prompt.md").read_text()
WORKDIR_PREFIX = "wat2do-ingestion-"
# The agent's final answer; "nothing" means the source changed no listing.
OUTCOME_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["outcome", "summary"],
    "properties": {
        "outcome": {"enum": ["added", "updated", "nothing"]},
        "summary": {"type": "string"},
    },
}
DIRECTORY_NOTE = (
    "A directory agent already read this page and confirmed it is a real event or position, "
    "so its details below are accurate. Your job is to avoid duplicates and fit it with what "
    "is already listed."
)


class AgentError(RuntimeError):
    """The agent could not finish; the queued item is retried."""


@dataclass(frozen=True)
class _Image:
    """One source image saved for the agent to view, kept until a row claims it."""

    file: str
    data: bytes
    content_type: str
    video_url: str | None


def ingest(post: dict, *, school: str, publisher_ig: str | None = None) -> bool:
    """Have the agent bring the database in line with one source; True if it changed anything."""
    source_url = post["url"]
    if already_imported(source_url):
        return True
    record = school_service.get_school(school)
    if record is None:
        raise AgentError("School is not registered")
    caption = normalize_scraped_text(post.get("caption") or post.get("text")) or ""
    token = uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix=WORKDIR_PREFIX) as workdir:
        images = _download_images(post, Path(workdir), instagram=is_instagram(source_url))
        owner = _owner_club(
            post, school=school, publisher_ig=publisher_ig, image_count=len(image_urls(post))
        )
        prompt = _render(
            post, school=record, caption=caption, images=images, token=token, owner=owner
        )
        # Allow for clock skew between this Mac and the database's added_at.
        started = datetime.now(UTC) - timedelta(minutes=5)
        try:
            return _run(prompt, workdir) != "nothing"
        finally:
            _store_chosen_posters(token, images)
            changes.stamp_new_rows(
                source_url, caption=caption, posted_at=_posted_at(post), since=started
            )
            changes.drain()


def is_instagram(source_url: str) -> bool:
    host = (urlsplit(source_url).hostname or "").removeprefix("www.")
    return host == "instagram.com"


def already_imported(source_url: str) -> bool:
    shortcode = _extract_shortcode(source_url) if is_instagram(source_url) else None
    if shortcode is not None:
        return bool(existing_shortcodes({shortcode}))
    return bool(existing_urls({source_url}) or existing_urls({source_url}, table=POSITIONS))


def candidate_handles(post: dict) -> list[str]:
    """Owner first, then coauthors, each once, without "@"."""
    owner = post.get("ownerUsername")
    handles = [owner] if isinstance(owner, str) else []
    for coauthor in post.get("coauthors") or []:
        handle = coauthor.get("username") if isinstance(coauthor, dict) else coauthor
        if isinstance(handle, str):
            handles.append(handle)
    cleaned = (handle.strip().lstrip("@").lower() for handle in handles)
    return list(dict.fromkeys(handle for handle in cleaned if handle))


def image_urls(post: dict) -> list[str]:
    """Pull image URLs from a retrieved Instagram post or directory page."""
    images = [
        (entry.get("url") if isinstance(entry, dict) else entry) or ""
        for entry in post.get("images") or []
    ]
    if not any(images):
        images = [
            child.get("displayUrl") or ""
            for child in post.get("childPosts") or []
            if isinstance(child, dict)
        ]
    if not any(images):
        images = [post.get("displayUrl") or ""]
    return [image for image in images if image]


def video_urls(post: dict) -> dict[str, str]:
    """Associate each carousel video's poster with its downloadable source."""
    videos: dict[str, str] = {}
    children = post.get("childPosts")
    records = (children if isinstance(children, list) else []) if is_carousel_post(post) else [post]
    for record in records:
        if not isinstance(record, dict):
            continue
        video = record.get("videoUrl")
        poster = record.get("displayUrl") or ""
        if isinstance(video, str) and video and isinstance(poster, str):
            videos[poster] = video
    return videos


def poster_reference(token: str, index: int) -> str:
    """What the agent writes as a poster until its image is stored."""
    return f"pending:{token}/image-{index}"


def _download_images(post: dict, workdir: Path, *, instagram: bool) -> list[_Image]:
    """Download each image once for the agent to view; nothing is stored yet."""
    videos = video_urls(post)
    fallback = single_post_video_url(post)
    images: list[_Image] = []
    for url in image_urls(post)[: CONTROL.max_images_per_item]:
        fetched = fetch_image(url, allow_all_domains=not instagram)
        if fetched is None:
            continue
        data, content_type = fetched
        name = f"image-{len(images)}{mimetypes.guess_extension(content_type) or '.jpg'}"
        (workdir / name).write_bytes(data)
        images.append(_Image(name, data, content_type, videos.get(url) or fallback))
    return images


def _store_chosen_posters(token: str, images: list[_Image]) -> None:
    """Store only the images the agent chose as posters and point their rows at them."""
    prefix = poster_reference(token, 0).removesuffix("0")
    stored: dict[str, dict[str, str | None]] = {}
    for table in (EVENTS, POSITIONS):
        rows = (
            get_sb()
            .table(table)
            .select("source_image_url")
            .like("source_image_url", f"{prefix}%")
            .execute()
            .data
            or []
        )
        for reference in {row["source_image_url"] for row in rows}:
            if reference not in stored:
                index = reference.removeprefix(prefix)
                image = images[int(index)] if index.isdigit() and int(index) < len(images) else None
                stored[reference] = _store_poster(image)
            get_sb().table(table).update(stored[reference]).eq(
                "source_image_url", reference
            ).execute()


def _store_poster(image: _Image | None) -> dict[str, str | None]:
    poster = store_image(image.data, image.content_type) if image else None
    video = upload_video_from_url(image.video_url) if image and poster and image.video_url else None
    return {"source_image_url": poster, **({"source_video_url": video} if video else {})}


def _owner_club(post: dict, *, school: str, publisher_ig: str | None, image_count: int) -> str:
    handles = candidate_handles(post)
    if handles:
        # A single-poster post from an unknown account still gets a club stub.
        club = resolve_club_for_scrape(
            ig_handle=handles,
            school=school,
            club_name=None,
            create_stub_if_missing=image_count <= 1,
        )
    elif publisher_ig:
        club = resolve_club_for_scrape(
            ig_handle=publisher_ig, school=school, club_name=None, create_stub_if_missing=False
        )
    else:
        return "unknown; find the host named in the source"
    if club.club_id is None:
        return f"@{handles[0] if handles else publisher_ig} (not registered at this school)"
    return f"{club.club_name} (clubs.id = {club.club_id}, Instagram @{club.ig_handle})"


def _render(
    post: dict,
    *,
    school,
    caption: str,
    images: list[_Image],
    token: str,
    owner: str,
) -> str:
    timezone = ZoneInfo(resolve_school_timezone(school.slug))
    now = datetime.now(timezone)
    posted = parse_iso_datetime(post.get("timestamp"))
    posted_local = posted.astimezone(timezone) if posted else now
    semester_end = current_semester_end(school.slug, now=now)
    instagram = is_instagram(post["url"])
    values = {
        "source_url": post["url"],
        "source_kind": "Instagram post" if instagram else "official school event-directory page",
        "ingestion_source": "instagram_scraper" if instagram else "directory",
        "school": school.slug,
        "school_id": str(school.id),
        "timezone": timezone.key,
        "today": now.strftime("%A %Y-%m-%d"),
        "posted_at": posted_local.strftime("%A %Y-%m-%d %H:%M"),
        "semester_line": f"Current semester ends: {semester_end}"
        if semester_end
        else "Current semester end: unknown",
        "owner_club": owner,
        "coauthors": ", ".join(f"@{h}" for h in candidate_handles(post)[1:]) or "none",
        "caption": caption or "(no text)",
        "source_note": "" if instagram else DIRECTORY_NOTE,
        "images": "\n".join(
            f"- Image {index}: ./{image.file}, poster reference `{poster_reference(token, index)}`"
            + (" (a video slide)" if image.video_url else "")
            for index, image in enumerate(images)
        )
        or "(no images)",
        "categories": ", ".join(f"'{category}'" for category in EVENT_CATEGORIES),
        "discovery_rules": EVENT_DISCOVERY_RULES,
        "campus_seasons": campus_season_prompt(school.slug),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _posted_at(post: dict) -> datetime | None:
    """When the Instagram post went up; directory pages have no post time."""
    return parse_iso_datetime(post.get("timestamp")) if is_instagram(post["url"]) else None


def _run(prompt: str, workdir: str) -> str:
    """Run the agent in ``workdir`` and return its reported outcome."""
    executable = shutil.which("claude")
    if executable is None:
        raise AgentError("Claude Code is not installed")
    try:
        result = subprocess.run(
            [
                executable,
                "-p",
                "--model",
                CONTROL.model,
                "--tools",
                "Read,Bash",
                "--allowedTools",
                "Read(./**)",
                "Bash(psql:*)",
                "--permission-mode",
                "dontAsk",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--output-format",
                "json",
                "--json-schema",
                json.dumps(OUTCOME_SCHEMA),
            ],
            input=prompt,
            cwd=workdir,
            env=_agent_environment(),
            capture_output=True,
            text=True,
            timeout=CONTROL.model_timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AgentError(f"Ingestion agent failed ({type(exc).__name__})") from None
    finally:
        remove_run_folder(workdir)
    if result.returncode:
        raise AgentError(f"Ingestion agent failed (exit {result.returncode})")
    return _outcome(result.stdout)


def _outcome(stdout: str) -> str:
    try:
        answer = json.loads(stdout).get("structured_output") or {}
    except (ValueError, AttributeError):
        answer = {}
    outcome = answer.get("outcome")
    if outcome not in OUTCOME_SCHEMA["properties"]["outcome"]["enum"]:
        raise AgentError("Ingestion agent gave no outcome")
    log.debug("Ingestion agent: %s", str(answer.get("summary"))[:500])
    return outcome


def claude_projects() -> Path:
    return Path.home() / ".claude/projects"


def remove_run_folder(workdir: str) -> None:
    """Delete the folder Claude Code keeps for a run, named after its working directory."""
    name = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(workdir))
    shutil.rmtree(claude_projects() / name, ignore_errors=True)


def remove_leftovers(prefix: str = WORKDIR_PREFIX) -> None:
    """Delete working and Claude Code folders that interrupted runs never cleaned up."""
    leftovers = [
        *Path(tempfile.gettempdir()).glob(f"{prefix}*"),
        *claude_projects().glob(f"*{re.sub(r'[^A-Za-z0-9]', '-', prefix)}*"),
    ]
    for folder in leftovers:
        shutil.rmtree(folder, ignore_errors=True)


def claude_environment() -> dict[str, str]:
    """Only what Claude Code itself needs; no application secrets."""
    inherited = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR")
    return {name: os.environ[name] for name in inherited if name in os.environ}


def _agent_environment() -> dict[str, str]:
    """Claude Code plus the scoped database login psql uses."""
    database = urlsplit(settings.ingest_agent_database_url)
    if not database.hostname or not database.username:
        raise AgentError("INGEST_AGENT_DATABASE_URL is not configured")
    return {
        **claude_environment(),
        "PGHOST": database.hostname,
        "PGPORT": str(database.port or 5432),
        "PGUSER": unquote(database.username),
        "PGPASSWORD": unquote(database.password or ""),
        "PGDATABASE": database.path.lstrip("/") or "postgres",
        "PGSSLMODE": "require",
        "PGAPPNAME": "wat2do-ingestion-agent",
    }
