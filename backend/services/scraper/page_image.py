"""Find the poster image a scraped event page advertises.

Directory pages state their event image in an Open Graph or Twitter meta tag or
in JSON-LD, which the Haiku directory agent cannot see through WebFetch's
Markdown. Reading it here, deterministically, is why directory events get a
poster at all; without it they fall back to the directory club's logo.

The directory agents read posters in Rust (``rust/src/ingestion/page_image.rs``);
this copy serves only ``scripts/backfill_directory_event_images.py``.
"""

from __future__ import annotations

import json
import logging
import re
from html import unescape
from urllib.parse import urljoin

import httpx

log = logging.getLogger(__name__)

# Some WAFs reject a browser User-Agent from a non-browser client, as the
# directory listing download already finds, so send the same curl UA.
_USER_AGENT = "curl/8.7.1"
_FETCH_TIMEOUT_SECONDS = 20.0
# The poster lives in <head>; a couple of megabytes is far more than enough.
_MAX_PAGE_BYTES = 2_000_000

_META = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_LD_JSON = re.compile(
    r'<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
# Path fragments that mark a site's own default/logo asset, not an event's poster.
# Event uploads live under /content/, /upload/ and the like, so those are kept; a
# page whose og:image is a default keeps the event's club-logo fallback instead.
_GENERIC_ASSET = re.compile(
    r"/system/|/clientlibs/|/static/|(?:^|[/\-_])(?:default|placeholder)[\-_.]",
    re.IGNORECASE,
)


def fetch_event_poster(url: str) -> str | None:
    """The absolute https poster URL a scraped event page advertises, or None."""
    html = _fetch_page(url)
    return extract_poster(html, url) if html is not None else None


def extract_poster(html: str, base_url: str) -> str | None:
    """Read og:image, then twitter:image, then a JSON-LD image, from page HTML.

    Returns an absolute https URL resolved against ``base_url``, or None when the
    page advertises no usable poster (the event then keeps its club-logo
    fallback). http posters and the site's own default/logo assets are rejected.
    """
    candidate = (
        _meta_content(html, "og:image")
        or _meta_content(html, "og:image:url")
        or _meta_content(html, "twitter:image")
        or _jsonld_image(html)
    )
    poster = _absolute_https(base_url, candidate)
    return None if poster and _GENERIC_ASSET.search(poster) else poster


def _fetch_page(url: str) -> str | None:
    if not url.lower().startswith(("http://", "https://")):
        return None
    try:
        with httpx.stream(
            "GET",
            url,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
            timeout=_FETCH_TIMEOUT_SECONDS,
        ) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) >= _MAX_PAGE_BYTES:
                    break
    except httpx.HTTPError:
        log.info("Could not read an event page for its poster")
        return None
    return bytes(body[:_MAX_PAGE_BYTES]).decode("utf-8", "replace")


def _meta_content(html: str, key: str) -> str | None:
    """The content of the first <meta property|name="key"> tag, any attribute order."""
    for tag in _META.findall(html):
        if re.search(rf'(?:property|name)\s*=\s*["\']{re.escape(key)}["\']', tag, re.IGNORECASE):
            match = re.search(r'content\s*=\s*["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if match and match.group(1).strip():
                return match.group(1)
    return None


def _jsonld_image(html: str) -> str | None:
    for block in _LD_JSON.findall(html):
        try:
            data = json.loads(block.strip())
        except (json.JSONDecodeError, ValueError):
            continue
        for node in _ld_nodes(data):
            url = _ld_image_url(node.get("image"))
            if url:
                return url
    return None


def _ld_nodes(data: object):
    """Walk a JSON-LD value, yielding every object (handles lists and @graph)."""
    if isinstance(data, list):
        for item in data:
            yield from _ld_nodes(item)
    elif isinstance(data, dict):
        yield data
        graph = data.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from _ld_nodes(item)


def _ld_image_url(image: object) -> str | None:
    if isinstance(image, str):
        return image or None
    if isinstance(image, dict):
        url = image.get("url")
        return url if isinstance(url, str) and url else None
    if isinstance(image, list):
        for item in image:
            url = _ld_image_url(item)
            if url:
                return url
    return None


def _absolute_https(base_url: str, candidate: str | None) -> str | None:
    if not candidate:
        return None
    absolute = urljoin(base_url, unescape(candidate.strip()))
    return absolute if absolute.lower().startswith("https://") else None
