"""Capture official school event-directory pages into the local ingestion queue.

Sources live in ``public.directory_sources``. Each scrape discovers event detail
URLs from a source's HTML, JSON, or iCalendar listing, skips URLs that already
back an event or position, and queues each page's text and artwork. Extraction
and persistence belong to the source-agnostic processor.
"""

from __future__ import annotations

import functools
import json
import logging
from datetime import date, datetime, time, timezone
from html import unescape
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from icalendar import Calendar

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import DIRECTORY_SOURCES, POSITIONS
from schemas.directory_source import DirectorySource
from services import club_service, school_service
from services.ingestion.queue import IngestionQueue, QueueItem
from services.scraper.dedup import existing_urls

log = logging.getLogger(__name__)

CONTROL = controlbox.ingestion
# Some WAFs reject a full browser user-agent from a non-browser HTTP client.
# A minimal command-line user-agent is accepted more consistently.
_USER_AGENT = "curl/8.7.1"
_IGNORED_IMAGE_WORDS = (
    "avatar",
    "logo",
    "icon",
    "spacer",
    "pixel",
    "tracker",
    "loading",
    "spinner",
    "placeholder",
)


def list_sources() -> list[DirectorySource]:
    rows = (
        get_sb()
        .table(DIRECTORY_SOURCES)
        .select(f"*,{school_service.SCHOOL_SLUG_EMBED}")
        .order("id")
        .execute()
    ).data or []
    return [DirectorySource.model_validate(school_service.with_school_slug(row)) for row in rows]


@functools.lru_cache(maxsize=1)
def _sources_by_school() -> dict[str, tuple[DirectorySource, ...]]:
    grouped: dict[str, list[DirectorySource]] = {}
    for source in list_sources():
        grouped.setdefault(source.school, []).append(source)
    return {school: tuple(sources) for school, sources in grouped.items()}


def default_club_logo(school: str | None, source_url: str | None) -> str | None:
    """Logo of the directory's publishing club, shown when the host club has none."""
    sources = _sources_by_school().get(school or "")
    if not sources:
        return None
    host = _host(source_url)
    source = next((s for s in sources if _host(s.url) == host), sources[0])
    if not source.default_club_ig:
        return None
    club = club_service.lookup_club_by_school_and_ig(source.school, source.default_club_ig)
    return club.get("logo_url") if club else None


def scrape_directories(queue: IngestionQueue) -> dict[str, int]:
    """Queue every new detail page from every directory source."""
    stats = {"sources": 0, "discovered": 0, "queued": 0, "failed": 0}
    for source in list_sources():
        stats["sources"] += 1
        try:
            urls = crawl_directory_links(source)
        except Exception:
            log.exception("[%s] Directory listing failed", source.name)
            stats["failed"] += 1
            continue
        stats["discovered"] += len(urls)
        known = existing_urls(set(urls)) | existing_urls(set(urls), table=POSITIONS)
        for url in urls:
            if url in known:
                continue
            text, images = scrape_event_page(url, source)
            if not text:
                continue
            post = {"url": url, "caption": text, "images": images}
            if queue.enqueue(
                QueueItem(school=source.school, post=post, directory_source_id=source.id)
            ):
                stats["queued"] += 1
    return stats


def matches_event_url(url: str, source: DirectorySource) -> bool:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if any(pattern in url for pattern in source.event_url_exclude_patterns):
            return False
        for pattern in source.event_url_patterns:
            target = urlsplit(
                urljoin(source.url, pattern) if pattern.startswith("/") else f"https://{pattern}"
            )
            if _host(url) == _host(target.geturl()) and target.path in parsed.path:
                return True
        return False
    except ValueError:
        return False


def crawl_directory_links(source: DirectorySource) -> list[str]:
    """Collect event detail URLs from an official HTML, JSON, or iCalendar listing."""
    event_urls: dict[str, None] = {}
    current_url: str | None = source.url
    pages = 0
    with httpx.Client(
        timeout=CONTROL.fetch_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT},
    ) as client:
        while current_url and pages < CONTROL.directory_max_listing_pages:
            response = client.get(current_url)
            response.raise_for_status()
            pages += 1
            if source.source_format == "ical":
                _add_ical_event_urls(event_urls, response.content, source)
                break
            if source.source_format == "json":
                _add_json_event_urls(event_urls, response.json(), source)
                break
            soup = BeautifulSoup(response.text, "html.parser")
            _add_html_event_urls(event_urls, soup, source)
            next_link = (
                soup.select_one(source.next_page_selector) if source.next_page_selector else None
            )
            current_url = (
                urljoin(current_url, next_link["href"].strip())
                if next_link and next_link.get("href")
                else None
            )
    return list(event_urls)[: CONTROL.directory_max_detail_pages_per_source]


def scrape_event_page(url: str, source: DirectorySource) -> tuple[str, list[str]]:
    """Fetch an event detail page and extract its main content text and image URLs."""
    try:
        response = httpx.get(
            url,
            headers={"User-Agent": _USER_AGENT},
            timeout=CONTROL.fetch_timeout_seconds,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("[%s] Failed to fetch event page (%s)", source.name, type(exc).__name__)
        return "", []

    soup = BeautifulSoup(response.text, "html.parser")
    content_text = ""
    if source.content_selector and (element := soup.select_one(source.content_selector)):
        content_text = element.get_text(separator="\n", strip=True)
    if not content_text:
        for selector in (".entry-content", "article", "#content", "main", "body"):
            if element := soup.select_one(selector):
                content_text = element.get_text(separator="\n", strip=True)
                break
    lines = [line.strip() for line in content_text.splitlines() if line.strip()]
    text = "\n".join(lines)[: CONTROL.fetch_max_text_characters]
    if host := _page_host(soup):
        text = f"Hosted by {host}\n{text}"
    return (text if lines else ""), _page_images(soup, url, source)[: CONTROL.fetch_max_images]


def _clean_event_url(url: str) -> str:
    """Remove fragments and trailing slashes without discarding identity query params."""
    parsed = urlsplit(urldefrag(url)[0])
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path.rstrip("/") or "/", parsed.query, "")
    )


def _add_event_url(event_urls: dict[str, None], candidate: str, source: DirectorySource) -> None:
    absolute_url = urljoin(source.url, candidate.strip())
    if not matches_event_url(absolute_url, source):
        return
    clean_url = _clean_event_url(absolute_url)
    if clean_url != _clean_event_url(source.url):
        event_urls.setdefault(clean_url, None)


def _iter_json_ld_event_urls(value: object):
    if isinstance(value, list):
        for item in value:
            yield from _iter_json_ld_event_urls(item)
        return
    if not isinstance(value, dict):
        return
    raw_type = value.get("@type")
    if "Event" in (raw_type if isinstance(raw_type, list) else [raw_type]) and isinstance(
        value.get("url"), str
    ):
        yield value["url"]
    for child in value.values():
        yield from _iter_json_ld_event_urls(child)


def _add_html_event_urls(
    event_urls: dict[str, None], soup: BeautifulSoup, source: DirectorySource
) -> None:
    for link in soup.find_all("a", href=True):
        _add_event_url(event_urls, link["href"], source)
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(script.get_text())
        except (TypeError, json.JSONDecodeError):
            continue
        for url in _iter_json_ld_event_urls(payload):
            _add_event_url(event_urls, url, source)


def _add_json_event_urls(
    event_urls: dict[str, None], value: object, source: DirectorySource
) -> None:
    if isinstance(value, list):
        for item in value:
            _add_json_event_urls(event_urls, item, source)
        return
    if not isinstance(value, dict):
        return
    if "title" in value:
        for url_field in source.json_url_fields:
            if isinstance(event_url := value.get(url_field), str):
                _add_event_url(event_urls, event_url, source)
    for child in value.values():
        if isinstance(child, (dict, list)):
            _add_json_event_urls(event_urls, child, source)


def _ical_start_utc(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=timezone.utc)
            if value.tzinfo is None
            else value.astimezone(timezone.utc)
        )
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def _add_ical_event_urls(
    event_urls: dict[str, None], content: bytes, source: DirectorySource
) -> None:
    today = datetime.now(timezone.utc).date()
    upcoming: list[tuple[datetime, str]] = []
    for component in Calendar.from_ical(content).walk("VEVENT"):
        event_url = component.get("URL")
        start = component.get("DTSTART")
        if event_url and start and _ical_start_utc(start.dt).date() >= today:
            upcoming.append((_ical_start_utc(start.dt), str(event_url)))
    for _start, event_url in sorted(upcoming):
        _add_event_url(event_urls, event_url, source)


def _page_host(soup: BeautifulSoup) -> str | None:
    # CampusGroups exposes the owning group independently of the description.
    host = soup.select_one('[aria-label^="Hosted By "] strong, .rsvp__event-org button')
    if host is not None:
        return host.get_text(" ", strip=True) or None

    # Other directories (including Penn Clubs) render a host label and group link.
    for label in soup.find_all(
        string=lambda text: bool(text) and text.strip().casefold().rstrip(":") == "hosted by"
    ):
        parent = label.parent
        if parent is None:
            continue
        link = parent.find("a") or (parent.parent.find("a") if parent.parent else None)
        if link is not None:
            return link.get_text(" ", strip=True) or None

    def organizer(value: object) -> str | None:
        if isinstance(value, list):
            return next((name for item in value if (name := organizer(item))), None)
        if not isinstance(value, dict):
            return None
        types = value.get("@type") or []
        if "Event" in ([types] if isinstance(types, str) else types):
            org = value.get("organizer")
            if isinstance(org, dict) and isinstance(org.get("name"), str):
                return unescape(org["name"]).strip() or None
        return next((name for item in value.values() if (name := organizer(item))), None)

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            if name := organizer(json.loads(script.get_text())):
                return name
        except (TypeError, json.JSONDecodeError):
            continue
    return None


def _page_images(soup: BeautifulSoup, url: str, source: DirectorySource) -> list[str]:
    """Event artwork in semantic priority: JSON-LD Event images, configured, then content."""
    images: dict[str, None] = {}

    def add(src: object) -> None:
        if not isinstance(src, str) or not src.strip():
            return
        absolute = urljoin(url, src.strip())
        path = urlsplit(absolute).path.casefold()
        if absolute.startswith("https://") and not any(w in path for w in _IGNORED_IMAGE_WORDS):
            images.setdefault(absolute, None)

    def event_images(value: object) -> None:
        if isinstance(value, list):
            for item in value:
                event_images(item)
        elif isinstance(value, dict):
            types = value.get("@type")
            if types == "Event" or isinstance(types, list) and "Event" in types:
                event_url = value.get("url")
                if not event_url or _clean_event_url(urljoin(url, event_url)) == _clean_event_url(
                    url
                ):
                    artwork = value.get("image")
                    for item in artwork if isinstance(artwork, list) else [artwork]:
                        add(
                            item.get("url") or item.get("contentUrl")
                            if isinstance(item, dict)
                            else item
                        )
            for child in value.values():
                if isinstance(child, (dict, list)):
                    event_images(child)

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            event_images(json.loads(script.get_text()))
        except (TypeError, json.JSONDecodeError):
            continue

    def add_element(img) -> None:
        # Lazy-load attributes hold the real image, src is often a spinner.
        add(img.get("data-src") or img.get("data-lazy-src") or img.get("src") or img.get("href"))

    if source.image_selector:
        for img in soup.select(source.image_selector):
            add_element(img)
    content = (
        soup.select_one(source.content_selector) if source.content_selector else None
    ) or soup.select_one(".entry-content, article, main")
    if content is not None:
        for img in content.find_all("img"):
            if img.find_parent(["header", "footer", "nav", "aside"]) is None:
                add_element(img)
    return list(images)


def _host(url: str | None) -> str:
    return (urlsplit(url or "").hostname or "").removeprefix("www.")
