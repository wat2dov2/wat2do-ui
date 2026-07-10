"""Download post/directory images and upload them via ``storage_service``.

Storage handles validation, EXIF stripping, and ``BUCKET_EVENT_IMAGES``.
Returned URLs are public-read. Fetch URLs are SSRF-checked in
``_is_safe_image_url`` before download.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Iterable
from urllib.parse import urlparse

import httpx

from core.constants import BUCKET_EVENT_IMAGES
from services.storage_service import storage

log = logging.getLogger(__name__)

# Instagram CDN occasionally rejects requests without a realistic browser UA.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_DOWNLOAD_TIMEOUT_SECONDS = 60.0
# Declared MIME fallback when the response Content-Type is missing/invalid.
_CONTENT_TYPE_FALLBACK = "image/jpeg"

# Suffix allowlist for Instagram/Meta CDN shards (e.g. scontent-*.cdninstagram.com).
# New Meta shards must be added here; prefer that over opening the SSRF surface.
_ALLOWED_HOST_SUFFIXES: tuple[str, ...] = (
    ".cdninstagram.com",
    ".fbcdn.net",
)


def _is_safe_image_url(url: str, allow_all_domains: bool = False) -> bool:
    """Return True if ``url`` is an HTTPS URL safe to fetch.

    Three layers of defence:
      1. Scheme must be ``https``. ``http`` is rejected (no transport
         security), as are ``file``/``ftp``/``data``.
      2. Host must end in one of ``_ALLOWED_HOST_SUFFIXES`` (or allow_all_domains must be True).
      3. The resolved IP must not be loopback / link-local / private /
         reserved. This catches DNS-rebinding-style attacks and any
         operator misconfiguration where a CDN suffix points internal.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if not allow_all_domains and not any(host.endswith(s) for s in _ALLOWED_HOST_SUFFIXES):
        return False

    # Resolve IPs and reject private/loopback/link-local. DNS failure => unsafe
    # so a transient resolution error never opens a fetch path.
    try:
        addrs = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    for family, _, _, _, sockaddr in addrs:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_reserved or ip.is_multicast:
            return False
    return True


def upload_image_from_url(url: str, allow_all_domains: bool = False) -> str | None:
    """Fetch ``url`` and push to the event-images bucket.

    Returns the public Storage URL on success, ``None`` on failure.
    Failures are logged and never raised; the caller drops that image.
    """
    if not _is_safe_image_url(url, allow_all_domains=allow_all_domains):
        log.warning("Refusing to fetch image - URL not allowed by safety check: %s", url)
        return None

    try:
        # No redirects: a controlled redirect must not bypass the allowlist.
        with httpx.Client(timeout=_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=False) as client:
            resp = client.get(url, headers={"User-Agent": _USER_AGENT})
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("Failed to download image %s: %s", url, e)
        return None
    except Exception as e:
        log.warning("Unexpected error downloading image %s: %s", url, e)
        return None

    content_type = resp.headers.get("content-type", "").split(";")[0].strip()
    if not content_type or "/" not in content_type:
        content_type = _CONTENT_TYPE_FALLBACK

    try:
        return storage.upload_file(
            BUCKET_EVENT_IMAGES,
            resp.content,
            content_type=content_type,
        )
    except Exception as e:
        # ValidationError (unsupported MIME, oversize, decoding failure)
        # falls in here too; we treat all upload failures as soft drops.
        log.warning("Failed to upload image %s -> bucket: %s", url, e)
        return None


def upload_post_images(image_urls: Iterable[str], allow_all_domains: bool = False) -> list[str]:
    """Upload each URL in order; omit failures from the returned list.

    Successful uploads keep relative order. Failed URLs are dropped (not
    replaced with ``None``), so ``image_index`` may shift when some fail.
    """
    uploaded: list[str] = []
    for url in image_urls:
        if not url:
            continue
        result = upload_image_from_url(url, allow_all_domains=allow_all_domains)
        if result is not None:
            uploaded.append(result)
    return uploaded
