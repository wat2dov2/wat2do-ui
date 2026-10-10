"""Let Haiku ingest one captured source straight into events and positions.

The agent reads the source, inspects what is already listed, and writes the
result itself through a database login scoped to events and positions. Its
instructions live in ``prompt.md``; this module only prepares the source and
applies the side effects of what the agent changed.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo

from core.config import settings
from core.constants import EVENT_CATEGORIES
from core.sanitize import normalize_scraped_text, parse_iso_datetime
from core.tables import POSITIONS
from services import school_service
from services.ingestion import changes
from services.ingestion.claude_completion import CONTROL, download_image
from services.school_context import (
    campus_season_prompt,
    current_semester_end,
    resolve_school_timezone,
)
from services.scraper.dedup import _extract_shortcode, existing_shortcodes, existing_urls
from services.scraper.extractor import EVENT_DISCOVERY_RULES
from services.scraper.image_uploader import (
    is_carousel_post,
    single_post_video_url,
    upload_post_images,
    upload_video_from_url,
)
from services.scraper.org_resolve import resolve_club_for_scrape

log = logging.getLogger(__name__)
PROMPT = Path(__file__).with_name("prompt.md").read_text()


class AgentError(RuntimeError):
    """The agent could not finish; the queued item is retried."""


def ingest(post: dict, *, school: str, publisher_ig: str | None = None) -> None:
    """Have the agent bring the database in line with one captured source."""
    source_url = post["url"]
    if already_imported(source_url):
        return
    record = school_service.get_school(school)
    if record is None:
        raise AgentError("School is not registered")
    media = _store_media(post, instagram=is_instagram(source_url))
    owner = _owner_club(post, school=school, publisher_ig=publisher_ig, image_count=len(media))
    caption = normalize_scraped_text(post.get("caption") or post.get("text")) or ""
    with tempfile.TemporaryDirectory(prefix="wat2do-ingestion-") as workdir:
        files = [
            download_image(stored, Path(workdir), f"image-{index}")
            for index, (stored, _) in enumerate(media[: CONTROL.max_images_per_item])
        ]
        prompt = _render(
            post, school=record, caption=caption, media=media, files=files, owner=owner
        )
        # A run interrupted before draining leaves its changes for the next item.
        changes.drain(caption=None)
        try:
            _run(prompt, workdir)
        finally:
            changes.drain(caption=caption)


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


def _store_media(post: dict, *, instagram: bool) -> list[tuple[str, str | None]]:
    """Upload each poster, paired with its video, to application storage."""
    sources = video_urls(post)
    fallback = single_post_video_url(post)
    stored_videos: dict[str, str | None] = {}
    media: list[tuple[str, str | None]] = []
    # One poster at a time keeps each carousel video attached to its slide
    # even when storage validation rejects an earlier poster.
    for url in image_urls(post):
        stored = upload_post_images([url], allow_all_domains=not instagram)
        if not stored:
            continue
        video = sources.get(url) or fallback
        if video and video not in stored_videos:
            stored_videos[video] = upload_video_from_url(video)
        media.append((stored[0], stored_videos.get(video) if video else None))
    return media


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
    media: list[tuple[str, str | None]],
    files: list[str | None],
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
        "images": "\n".join(
            (f"- Image {index}: ./{name}" if name else f"- Image {index}: (could not be loaded)")
            + f", stored as {stored}"
            + (f", video stored as {video}" if video else "")
            for index, ((stored, video), name) in enumerate(zip(media, files, strict=False))
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


def _run(prompt: str, workdir: str) -> None:
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
                "text",
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
    if result.returncode:
        raise AgentError(f"Ingestion agent failed (exit {result.returncode})")
    log.debug("Ingestion agent: %s", result.stdout.strip()[-500:])


def _agent_environment() -> dict[str, str]:
    """Only what Claude Code and psql need; no application secrets."""
    database = urlsplit(settings.ingest_agent_database_url)
    if not database.hostname or not database.username:
        raise AgentError("INGEST_AGENT_DATABASE_URL is not configured")
    inherited = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR")
    return {
        **{name: os.environ[name] for name in inherited if name in os.environ},
        "PGHOST": database.hostname,
        "PGPORT": str(database.port or 5432),
        "PGUSER": unquote(database.username),
        "PGPASSWORD": unquote(database.password or ""),
        "PGDATABASE": database.path.lstrip("/") or "postgres",
        "PGSSLMODE": "require",
        "PGAPPNAME": "wat2do-ingestion-agent",
    }
