"""Official directory event scraper service.

Discovers event detail URLs from HTML, JSON, and iCalendar sources, fetches
their pages, and feeds the page text/images to the existing AI extractor.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Literal
from urllib.parse import urldefrag, urljoin, urlparse, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from icalendar import Calendar
from pydantic import BaseModel, Field

from core.controlbox import controlbox
from services.scraper.dedup import (
    collapse_duplicate_extractions,
    existing_urls,
    find_candidates,
)
from services.scraper.event_writer import write_event
from services.scraper.extractor import extract_events_from_post
from services.scraper.image_uploader import upload_post_images
from services.scraper.org_resolve import ResolvedOrganization, resolve_organization_for_scrape
from services.scraper.reconciler import reconcile_events

log = logging.getLogger(__name__)

# Some WAFs reject a full browser user-agent from a non-browser HTTP client.
# A minimal command-line user-agent is accepted more consistently.
_USER_AGENT = "curl/8.7.1"
_HTTP_TIMEOUT_SECONDS = 30.0


class DirectoryConfig(BaseModel):
    """Configuration schema for a directory scraper target."""

    id: str
    name: str
    school: str
    default_organization: str
    source_format: Literal["html", "ical", "json"]
    entry_url: str
    event_url_patterns: list[str]
    event_url_exclude_patterns: list[str] = Field(default_factory=list)
    json_url_fields: list[str] = Field(default_factory=lambda: ["url"])
    next_page_selector: str | None = None
    content_selector: str | None = None
    image_selector: str | None = None


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


def _matches_event_url(url: str, config: DirectoryConfig) -> bool:
    parsed = urlsplit(url)
    path_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    return any(pattern in path_url for pattern in config.event_url_patterns) and not any(
        pattern in url for pattern in config.event_url_exclude_patterns
    )


def _add_event_url(event_urls: dict[str, None], candidate: str, config: DirectoryConfig) -> None:
    absolute_url = urljoin(config.entry_url, candidate.strip())
    if not _matches_event_url(absolute_url, config):
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

    images: set[str] = set()

    if config.image_selector:
        img_elements = soup.select(config.image_selector)
        for img in img_elements:
            src = img.get("src") or img.get("data-src") or img.get("href")
            if src:
                images.add(urljoin(url, src.strip()))

    content_area = None
    if config.content_selector:
        content_area = soup.select_one(config.content_selector)
    if not content_area:
        content_area = (
            soup.select_one("article") or soup.select_one("#content") or soup.select_one("body")
        )

    if content_area:
        for img in content_area.find_all("img"):
            src = img.get("src") or img.get("data-src")
            if src:
                src_abs = urljoin(url, src.strip())
                parsed_src = urlparse(src_abs)
                if parsed_src.scheme in ("http", "https"):
                    # Skip icons/avatars/trackers by URL substring heuristic.
                    src_lower = src_abs.lower()
                    if not any(
                        x in src_lower
                        for x in ("avatar", "logo", "icon", "spacer", "pixel", "tracker")
                    ):
                        images.add(src_abs)

    return cleaned_content, sorted(list(images))


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
                source_organization=config.default_organization,
            )
            result.events_extracted += len(extracted_events)

            if not extracted_events:
                log.info("[%s] No events extracted by AI from: %s", config.id, url)
                continue

            for event in extracted_events:
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

            resolved_orgs = [
                _resolve_directory_organization(event, config) for event in extracted_events
            ]
            extracted_events, source_indexes, duplicate_count = collapse_duplicate_extractions(
                extracted_events,
                organization_ids=[r.organization_id for r in resolved_orgs],
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
                    organization_id=resolved.organization_id,
                    organization_name=resolved.organization_name
                    or ((event.get("organization") or "").strip() or None),
                )
                for event, resolved in zip(extracted_events, resolved_orgs, strict=True)
            ]
            reconciled = reconcile_events(
                extracted_events=extracted_events,
                candidates_by_index=candidates_by_index,
                caption_text=text,
                school=config.school,
                resolved_organization_ids=[r.organization_id for r in resolved_orgs],
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
                    resolved = _resolve_directory_organization(event, config)
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


def _resolve_directory_organization(event: dict, config: DirectoryConfig) -> ResolvedOrganization:
    """Keep a known explicit host, otherwise use the directory publisher."""
    extracted_name = (event.get("organization") or "").strip() or None
    resolved = resolve_organization_for_scrape(
        ig_handle=None,
        school=config.school,
        organization_name=extracted_name,
        create_stub_if_missing=False,
    )
    if resolved.organization_id is not None:
        event["organization"] = resolved.organization_name or extracted_name or ""
        return resolved

    event["organization"] = config.default_organization
    return resolve_organization_for_scrape(
        ig_handle=None,
        school=config.school,
        organization_name=config.default_organization,
        create_stub_if_missing=False,
    )
