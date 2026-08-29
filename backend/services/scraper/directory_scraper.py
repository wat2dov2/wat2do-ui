"""Web directory event scraper service.

Crawls event list pages, follows pagination (Next buttons), fetches detail pages,
and feeds their text/images to the existing AI vision/text extractor.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel

from services.scraper.dedup import (
    collapse_duplicate_extractions,
    existing_urls,
    find_candidates,
)
from services.scraper.event_writer import write_event
from services.scraper.extractor import extract_events_from_post
from services.scraper.image_uploader import upload_post_images
from services.scraper.org_resolve import resolve_organization_for_scrape
from services.scraper.reconciler import reconcile_events

log = logging.getLogger(__name__)

# Realistic User-Agent to avoid getting blocked by DDoS protection / WAFs.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_HTTP_TIMEOUT_SECONDS = 30.0


class DirectoryConfig(BaseModel):
    """Configuration schema for a directory scraper target."""

    id: str
    name: str
    school: str
    entry_url: str
    event_url_contains: str
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


def crawl_directory_links(config: DirectoryConfig, max_pages: int = 5) -> list[str]:
    """Crawl the directory list page following pagination to collect event detail URLs."""
    event_urls: set[str] = set()
    current_url = config.entry_url
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
            soup = BeautifulSoup(resp.text, "html.parser")

            links = soup.find_all("a", href=True)
            for link in links:
                href = link["href"].strip()
                absolute_url = urljoin(current_url, href)
                # Match by URL substring pattern only (not a same-domain check).
                if config.event_url_contains in absolute_url:
                    # Strip query strings/fragments for clean deduplication
                    clean_url = absolute_url.split("?")[0].split("#")[0].rstrip("/")
                    if clean_url != config.entry_url.rstrip("/"):
                        event_urls.add(clean_url)

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
    return sorted(list(event_urls))


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
                resolve_organization_for_scrape(
                    ig_handle=None,
                    school=config.school,
                    organization_name=(event.get("organization") or "").strip() or None,
                    create_stub_if_missing=False,
                )
                for event in extracted_events
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
                    resolved = resolve_organization_for_scrape(
                        ig_handle=None,
                        school=config.school,
                        organization_name=(event.get("organization") or "").strip() or None,
                        create_stub_if_missing=False,
                    )
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
