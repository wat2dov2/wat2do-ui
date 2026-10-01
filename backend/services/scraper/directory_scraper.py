"""Official directory event scraper service.

Discovers event detail URLs from HTML, JSON, and iCalendar sources, fetches
their pages, and feeds the page text/images to the existing AI extractor.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from html import unescape
from urllib.parse import urldefrag, urljoin, urlparse, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from icalendar import Calendar

from core.controlbox import controlbox
from services.scraper.dedup import (
    collapse_duplicate_extractions,
    existing_urls,
    find_candidates,
)
from services.scraper.directory_config import DirectoryConfig, matches_event_url
from services.scraper.event_writer import write_event
from services.scraper.extractor import extract_events_from_post
from services.scraper.image_uploader import upload_post_images
from services.scraper.org_resolve import ResolvedClub, resolve_club_for_scrape
from services.scraper.reconciler import reconcile_events

log = logging.getLogger(__name__)

# Some WAFs reject a full browser user-agent from a non-browser HTTP client.
# A minimal command-line user-agent is accepted more consistently.
_USER_AGENT = "curl/8.7.1"
_HTTP_TIMEOUT_SECONDS = 30.0


@dataclass
class DirectoryScrapeResult:
    """Detailed summary of the scrape job for reporting."""

    directory_name: str
    pages_crawled: int = 0
    urls_found: int = 0
    urls_new: int = 0
    events_extracted: int = 0
    events_saved: int = 0
    events_updated: int = 0
    events_duplicates: int = 0
    errors: list[str] = field(default_factory=list)


def _clean_event_url(url: str) -> str:
    """Remove fragments and trailing slashes without discarding identity query params."""
    fragmentless_url, _fragment = urldefrag(url)
    parsed = urlsplit(fragmentless_url)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, ""))


def _add_event_url(event_urls: dict[str, None], candidate: str, config: DirectoryConfig) -> None:
    absolute_url = urljoin(config.entry_url, candidate.strip())
    if not matches_event_url(absolute_url, config):
        return

    clean_url = _clean_event_url(absolute_url)
    if clean_url != _clean_event_url(config.entry_url):
        event_urls.setdefault(clean_url, None)


def _iter_json_ld_event_urls(value: object):
    if isinstance(value, list):
        for item in value:
            yield from _iter_json_ld_event_urls(item)
        return
    if not isinstance(value, dict):
        return

    raw_type = value.get("@type")
    types = raw_type if isinstance(raw_type, list) else [raw_type]
    if "Event" in types and isinstance(value.get("url"), str):
        yield value["url"]

    for child in value.values():
        yield from _iter_json_ld_event_urls(child)


def _add_html_event_urls(event_urls: dict[str, None], html: str, config: DirectoryConfig) -> None:
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("a", href=True):
        _add_event_url(event_urls, link["href"], config)

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(script.get_text())
        except (TypeError, json.JSONDecodeError):
            continue
        for url in _iter_json_ld_event_urls(payload):
            _add_event_url(event_urls, url, config)


def _add_json_event_urls(
    event_urls: dict[str, None], value: object, config: DirectoryConfig
) -> None:
    if isinstance(value, list):
        for item in value:
            _add_json_event_urls(event_urls, item, config)
        return
    if not isinstance(value, dict):
        return

    if "title" in value:
        for url_field in config.json_url_fields:
            event_url = value.get(url_field)
            if isinstance(event_url, str):
                _add_event_url(event_urls, event_url, config)

    for child in value.values():
        if isinstance(child, (dict, list)):
            _add_json_event_urls(event_urls, child, config)


def _ical_start_utc(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def _add_ical_event_urls(
    event_urls: dict[str, None], content: bytes, config: DirectoryConfig
) -> None:
    calendar = Calendar.from_ical(content)
    today_utc = datetime.now(timezone.utc).date()
    upcoming_events: list[tuple[datetime, str]] = []
    for component in calendar.walk("VEVENT"):
        event_url = component.get("URL")
        start_property = component.get("DTSTART")
        if not event_url or not start_property:
            continue
        start = _ical_start_utc(start_property.dt)
        if start.date() >= today_utc:
            upcoming_events.append((start, str(event_url)))

    upcoming_events.sort(key=lambda item: item[0])
    for _start, event_url in upcoming_events:
        _add_event_url(event_urls, event_url, config)


def crawl_directory_links(config: DirectoryConfig, max_pages: int = 5) -> list[str]:
    """Collect event detail URLs from an official HTML, JSON, or iCalendar feed."""
    event_urls: dict[str, None] = {}
    current_url: str | None = config.entry_url
    pages_crawled = 0

    headers = {"User-Agent": _USER_AGENT}

    with httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
        while current_url and pages_crawled < max_pages:
            log.info("[%s] Fetching page %d: %s", config.id, pages_crawled + 1, current_url)
            try:
                resp = client.get(current_url, headers=headers)
                resp.raise_for_status()
            except Exception as e:
                log.error("[%s] Failed to fetch list page %s: %s", config.id, current_url, e)
                break

            pages_crawled += 1
            if config.source_format == "ical":
                _add_ical_event_urls(event_urls, resp.content, config)
                current_url = None
                continue

            if config.source_format == "json":
                _add_json_event_urls(event_urls, resp.json(), config)
                current_url = None
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            _add_html_event_urls(event_urls, resp.text, config)

            next_url = None
            if config.next_page_selector:
                next_link = soup.select_one(config.next_page_selector)
                if next_link and next_link.get("href"):
                    next_url = urljoin(current_url, next_link["href"].strip())

            current_url = next_url

    log.info(
        "[%s] Completed crawl. Found %d event URLs across %d page(s)",
        config.id,
        len(event_urls),
        pages_crawled,
    )
    urls = list(event_urls)
    maximum_urls = controlbox.scraping.directory_maximum_events_per_source
    if len(urls) > maximum_urls:
        log.info(
            "[%s] Limiting %d discovered URLs to the configured maximum of %d",
            config.id,
            len(urls),
            maximum_urls,
        )
    return urls[:maximum_urls]


def directory_event_host(text: str) -> str | None:
    """Read the host explicitly identified by the directory page parser."""
    prefix = "Directory event host: "
    first_line = text.split("\n", 1)[0]
    return (
        first_line.removeprefix(prefix).strip() or None if first_line.startswith(prefix) else None
    )


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


def scrape_event_page(url: str, config: DirectoryConfig) -> tuple[str, list[str]]:
    """Fetch an event detail page and extract its main content text and image URLs."""
    headers = {"User-Agent": _USER_AGENT}
    try:
        resp = httpx.get(url, headers=headers, timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.error("[%s] Failed to fetch event page %s: %s", config.id, url, e)
        return "", []

    soup = BeautifulSoup(resp.text, "html.parser")

    content_text = ""
    if config.content_selector:
        content_element = soup.select_one(config.content_selector)
        if content_element:
            content_text = content_element.get_text(separator="\n", strip=True)

    if not content_text:
        for selector in [".entry-content", "article", "#content", "main", "body"]:
            element = soup.select_one(selector)
            if element:
                content_text = element.get_text(separator="\n", strip=True)
                break

    content_lines = [line.strip() for line in content_text.splitlines() if line.strip()]
    cleaned_content = "\n".join(content_lines)
    if host := _page_host(soup):
        cleaned_content = f"Directory event host: {host}\n{cleaned_content}"

    # Preserve semantic priority. Sorting by URL let loading GIFs and unrelated
    # page chrome become image zero, the default poster chosen by extraction.
    images: dict[str, None] = {}

    def add_image(src: object) -> None:
        if not isinstance(src, str) or not src.strip():
            return
        absolute = urljoin(url, src.strip())
        parsed = urlparse(absolute)
        if parsed.scheme != "https":
            return
        path = parsed.path.casefold()
        if any(
            word in path
            for word in (
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
        ):
            return
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
                        add_image(
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

    def add_element_image(img) -> None:
        # Lazy-load attributes hold the real image, src is often a spinner.
        add_image(
            img.get("data-src") or img.get("data-lazy-src") or img.get("src") or img.get("href")
        )

    if config.image_selector:
        for img in soup.select(config.image_selector):
            add_element_image(img)

    content_area = soup.select_one(config.content_selector) if config.content_selector else None
    if content_area is None:
        content_area = soup.select_one(".entry-content, article, main")
    if content_area is not None:
        for img in content_area.find_all("img"):
            if img.find_parent(["header", "footer", "nav", "aside"]) is None:
                add_element_image(img)

    return cleaned_content, list(images)


def run_directory_pipeline(
    config: DirectoryConfig, *, max_pages: int = 5, dry_run: bool = False
) -> DirectoryScrapeResult:
    """Run the scraping pipeline for a single directory target."""
    log.info("Starting pipeline for directory: %s (%s)", config.name, config.school)
    result = DirectoryScrapeResult(directory_name=config.name)

    try:
        event_urls = crawl_directory_links(config, max_pages=max_pages)
        result.pages_crawled = min(max_pages, len(event_urls) + 1)  # Approximate count
        result.urls_found = len(event_urls)
    except Exception as e:
        err_msg = f"Crawl failed: {e}"
        log.exception(err_msg)
        result.errors.append(err_msg)
        return result

    scraped_urls: set[str] = set()
    if not dry_run and event_urls:
        scraped_urls = existing_urls(set(event_urls))

    for url in event_urls:
        log.info("[%s] Processing URL: %s", config.id, url)

        # Dry-run re-parses already-scraped URLs so parsing can be tested end-to-end.
        if not dry_run and url in scraped_urls:
            log.info("[%s] URL already scraped - skipping: %s", config.id, url)
            continue

        result.urls_new += 1

        try:
            text, images = scrape_event_page(url, config)
            if not text:
                log.warning(
                    "[%s] No text extracted from %s; skipping AI extraction", config.id, url
                )
                continue

            uploaded_images = []
            if images:
                log.info("[%s] Found %d candidate images. Uploading...", config.id, len(images))
                # Directory hosts are not Instagram CDN; open the host allowlist.
                uploaded_images = upload_post_images(images, allow_all_domains=True)

            log.info(
                "[%s] Sending content to AI for extraction (%d images)",
                config.id,
                len(uploaded_images),
            )
            extracted_events = extract_events_from_post(
                caption_text=text,
                image_urls=uploaded_images,
                post_created_at=None,  # Extractor falls back to "now" in school TZ
                school=config.school,
                source_club=config.default_club if config.default_club_ig else None,
            )
            result.events_extracted += len(extracted_events)

            if not extracted_events:
                log.info("[%s] No events extracted by AI from: %s", config.id, url)
                continue

            for event in extracted_events:
                if host := directory_event_host(text):
                    event["club"] = host
                try:
                    idx = int(event.get("image_index") or 0)
                except (TypeError, ValueError):
                    idx = 0
                if uploaded_images:
                    event["source_image_url"] = uploaded_images[
                        idx if 0 <= idx < len(uploaded_images) else 0
                    ]
                event["school"] = config.school

            if dry_run:
                for event in extracted_events:
                    log.info("[%s] [DRY-RUN] Would save event: %r", config.id, event.get("title"))
                    result.events_saved += 1
                continue

            resolved_orgs = [_resolve_directory_club(event, config) for event in extracted_events]
            extracted_events, source_indexes, duplicate_count = collapse_duplicate_extractions(
                extracted_events,
                club_ids=[r.club_id for r in resolved_orgs],
                ig_handles=[r.ig_handle for r in resolved_orgs],
            )
            if duplicate_count:
                result.events_duplicates += duplicate_count
                resolved_orgs = [resolved_orgs[index] for index in source_indexes]
                log.info(
                    "[%s] Collapsed %d same-page duplicate event extraction(s)",
                    config.id,
                    duplicate_count,
                )
            candidates_by_index = [
                find_candidates(
                    title=event.get("title") or "",
                    location=event.get("location") or "",
                    description=event.get("description") or "",
                    occurrences=event.get("occurrences") or [],
                    ig_handle=resolved.ig_handle,
                    club_id=resolved.club_id,
                    club_name=resolved.club_name or ((event.get("club") or "").strip() or None),
                )
                for event, resolved in zip(extracted_events, resolved_orgs, strict=True)
            ]
            reconciled = reconcile_events(
                extracted_events=extracted_events,
                candidates_by_index=candidates_by_index,
                caption_text=text,
                school=config.school,
                resolved_club_ids=[r.club_id for r in resolved_orgs],
                resolved_ig_handles=[r.ig_handle for r in resolved_orgs],
            )
            to_write = (
                reconciled
                if reconciled is not None
                else [{**e, "id": None} for e in extracted_events]
            )
            if reconciled is None:
                log.warning(
                    "[%s] Pass 2 failed; falling back to insert-only Pass 1 events",
                    config.id,
                )

            for i, event in enumerate(to_write):
                if len(to_write) == len(resolved_orgs):
                    resolved = resolved_orgs[i]
                else:
                    resolved = _resolve_directory_club(event, config)
                outcome = write_event(event, ig_handle=None, source_url=url, resolved_org=resolved)
                if outcome == "inserted":
                    result.events_saved += 1
                elif outcome == "updated":
                    result.events_updated += 1
                    result.events_saved += 1

        except Exception as e:
            err_msg = f"Failed to process URL {url}: {e}"
            log.exception(err_msg)
            result.errors.append(err_msg)

    return result


def _resolve_directory_club(event: dict, config: DirectoryConfig) -> ResolvedClub:
    """Preserve explicit hosts; use the student union only when no host is named."""
    extracted_name = (event.get("club") or "").strip() or None
    if (
        config.publisher_club
        and extracted_name
        and extracted_name.casefold() == config.publisher_club.casefold()
    ):
        extracted_name = None
    resolved = resolve_club_for_scrape(
        ig_handle=None,
        school=config.school,
        club_name=extracted_name,
        create_stub_if_missing=False,
    )
    if resolved.club_id is not None and not (
        config.default_club_ig and extracted_name == config.default_club
    ):
        event["club"] = resolved.club_name or extracted_name or ""
        return resolved

    union_initials = "".join(
        word[0]
        for word in config.default_club.split()
        if word.casefold() not in {"of", "the", "and", "at"}
    ).casefold()
    if extracted_name and extracted_name.casefold() not in {
        config.default_club.casefold(),
        union_initials,
    }:
        # An unknown named host is still the host. Do not attribute its event to the union.
        return ResolvedClub(club_id=None, club_name=extracted_name, ig_handle=None)

    event["club"] = config.default_club
    if not config.default_club_ig:
        return ResolvedClub(club_id=None, club_name=config.default_club, ig_handle=None)
    return resolve_club_for_scrape(
        ig_handle=config.default_club_ig,
        school=config.school,
        club_name=config.default_club,
        create_stub_if_missing=False,
    )
