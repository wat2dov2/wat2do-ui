"""Read official directory artwork for existing event media repair."""

from __future__ import annotations

import json
import logging
from urllib.parse import urldefrag, urljoin, urlparse, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from services.scraper.directory_config import DirectoryConfig

log = logging.getLogger(__name__)
_USER_AGENT = "curl/8.7.1"
_HTTP_TIMEOUT_SECONDS = 30.0


def _clean_event_url(url: str) -> str:
    """Remove fragments and trailing slashes without discarding identity query params."""
    fragmentless_url, _fragment = urldefrag(url)
    parsed = urlsplit(fragmentless_url)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, ""))


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
