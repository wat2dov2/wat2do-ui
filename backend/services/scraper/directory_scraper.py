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

from core.database import get_sb
from core.tables import EVENTS
from services.scraper.event_writer import write_event
from services.scraper.extractor import extract_events_from_post
from services.scraper.image_uploader import upload_post_images

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


def is_url_scraped(url: str) -> bool:
    """Check if an event page URL has already been scraped and written to the database."""
    try:
        # Check source_url column in events table
        res = get_sb().table(EVENTS).select("id").eq("source_url", url).limit(1).execute()
        return bool(res.data)
    except Exception as e:
        log.warning("Failed to query DB for source_url=%s: %s", url, e)
        return False


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

            # Extract all matching event links
            links = soup.find_all("a", href=True)
            for link in links:
                href = link["href"].strip()
                absolute_url = urljoin(current_url, href)
                # Ensure the link belongs to the same domain and matches the event pattern
                if config.event_url_contains in absolute_url:
                    # Strip query strings/fragments for clean deduplication
                    clean_url = absolute_url.split("?")[0].split("#")[0].rstrip("/")
                    # Do not add entry_url itself to event links
                    if clean_url != config.entry_url.rstrip("/"):
                        event_urls.add(clean_url)

            # Find next page link
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

    # 1. Content Text Extraction
    content_text = ""
    if config.content_selector:
        content_element = soup.select_one(config.content_selector)
        if content_element:
            content_text = content_element.get_text(separator="\n", strip=True)

    if not content_text:
        # Fallback to general content selectors
        for selector in [".entry-content", "article", "#content", "main", "body"]:
            element = soup.select_one(selector)
            if element:
                content_text = element.get_text(separator="\n", strip=True)
                break

    # Clean up whitespace
    content_lines = [line.strip() for line in content_text.splitlines() if line.strip()]
    cleaned_content = "\n".join(content_lines)

    # 2. Image Extraction
    images: set[str] = set()

    # Try custom selector first
    if config.image_selector:
        img_elements = soup.select(config.image_selector)
        for img in img_elements:
            src = img.get("src") or img.get("data-src") or img.get("href")
            if src:
                images.add(urljoin(url, src.strip()))

    # Fallback/Union: grab images inside the body/content area
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
                # Filter out tracking pixels / tiny icons
                parsed_src = urlparse(src_abs)
                if parsed_src.scheme in ("http", "https"):
                    # Basic heuristics to avoid spacer gifs, icons, and avatars
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

    # 1. Crawl list pages for event detail links
    try:
        event_urls = crawl_directory_links(config, max_pages=max_pages)
        result.pages_crawled = min(max_pages, len(event_urls) + 1)  # Approximate count
        result.urls_found = len(event_urls)
    except Exception as e:
        err_msg = f"Crawl failed: {e}"
        log.exception(err_msg)
        result.errors.append(err_msg)
        return result

    # 2. Process each URL
    for url in event_urls:
        log.info("[%s] Processing URL: %s", config.id, url)

        # Check if already scraped in DB (skipped in dry-run to test parsing)
        if not dry_run and is_url_scraped(url):
            log.info("[%s] URL already scraped — skipping: %s", config.id, url)
            continue

        result.urls_new += 1

        try:
            # 3. Extract text & images
            text, images = scrape_event_page(url, config)
            if not text:
                log.warning(
                    "[%s] No text extracted from %s; skipping AI extraction", config.id, url
                )
                continue

            # 4. Upload images (allow general domains)
            uploaded_images = []
            if images:
                log.info("[%s] Found %d candidate images. Uploading...", config.id, len(images))
                uploaded_images = upload_post_images(images, allow_all_domains=True)

            # 5. Extract events using AI vision/text service
            log.info(
                "[%s] Sending content to AI for extraction (%d images)",
                config.id,
                len(uploaded_images),
            )
            extracted_events = extract_events_from_post(
                caption_text=text,
                image_urls=uploaded_images,
                post_created_at=None,  # Handled inside extractor relative to current time
                school=config.school,
            )
            result.events_extracted += len(extracted_events)

            if not extracted_events:
                log.info("[%s] No events extracted by AI from: %s", config.id, url)
                continue

            # 6. Save events to database
            for event in extracted_events:
                # Map source image URL based on image_index returned by AI
                try:
                    idx = int(event.get("image_index") or 0)
                except (TypeError, ValueError):
                    idx = 0
                if uploaded_images:
                    event["source_image_url"] = uploaded_images[
                        idx if 0 <= idx < len(uploaded_images) else 0
                    ]

                if dry_run:
                    log.info("[%s] [DRY-RUN] Would save event: %r", config.id, event.get("title"))
                    result.events_saved += 1
                    continue

                # Pass ig_handle=None since it is a web directory source
                outcome = write_event(event, ig_handle=None, source_url=url)
                if outcome == "inserted":
                    result.events_saved += 1
                elif outcome == "updated":
                    result.events_updated += 1
                    result.events_saved += 1
                elif outcome == "duplicate":
                    result.events_duplicates += 1

        except Exception as e:
            err_msg = f"Failed to process URL {url}: {e}"
            log.exception(err_msg)
            result.errors.append(err_msg)

    return result
