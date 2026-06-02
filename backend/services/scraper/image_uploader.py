"""Download Instagram images and hand them to the storage service.

The scraper passes bytes to ``services.storage_service``, which handles
validation, EXIF stripping, and bucket selection (``BUCKET_EVENT_IMAGES``).

Returned URLs are public (the bucket is set to public-read in the
``StorageService._DEFAULT_BUCKETS`` config) and cache-friendly.

SSRF protection: the URL we fetch comes from Apify's representation of
an Instagram post, which is influenced by content the post owner
controls. Without an allowlist the worker would happily fetch
``http://169.254.169.254/...`` (cloud metadata services) or internal
services like ``http://localhost:8000/...`` and then upload the response
bytes to a public storage bucket — leaking IAM credentials or admin
endpoints. ``_is_safe_image_url`` narrows the source to
HTTPS Instagram CDN domains.
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
# Map common content-type prefixes to a canonical MIME for the bucket
# allowlist. Storage validation does its own SVG/EXIF handling — we just
# pick the right declared MIME so the upload isn't rejected upfront.
_CONTENT_TYPE_FALLBACK = "image/jpeg"

# Instagram serves images from a small, well-known set of CDN hosts.
# Tightening to suffix-match keeps the allowlist short while covering
# the regional shards Apify returns (scontent-iad-1.cdninstagram.com,
# scontent.fora1-1.fna.fbcdn.net, …). New domain shards added by Meta
# would have to be added here — we accept that maintenance cost rather
# than expose the full SSRF surface.
_ALLOWED_HOST_SUFFIXES: tuple[str, ...] = (
    ".cdninstagram.com",
    ".fbcdn.net",
)


def _is_safe_image_url(url: str) -> bool:
    """Return True if ``url`` is an HTTPS Instagram CDN URL safe to fetch.

    Three layers of defence:
      1. Scheme must be ``https``. ``http`` is rejected (no transport
         security to the CDN), as are ``file``/``ftp``/``data``.
      2. Host must end in one of ``_ALLOWED_HOST_SUFFIXES``.
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
    if not any(host.endswith(s) for s in _ALLOWED_HOST_SUFFIXES):
        return False

    # Resolve to IP(s) and reject private/loopback/link-local. ``getaddrinfo``
    # raises on resolution failure — treat as "unsafe" so a transient DNS
    # error doesn't open a fetch path.
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


def upload_image_from_url(url: str) -> str | None:
    """Fetch ``url`` from Instagram CDN, push to event-images bucket.

    Returns the public Supabase Storage URL on success, ``None`` on any
    failure. Failures are logged but never raised — the pipeline tolerates
    individual image upload errors and just drops that image from the
    list passed to the extractor.
    """
    if not _is_safe_image_url(url):
        log.warning("Refusing to fetch image — URL not on the IG CDN allowlist: %s", url)
        return None

    try:
        # ``follow_redirects=False`` keeps the safety check meaningful —
        # an attacker who controls a redirect destination can't pivot
        # through the allowlist.
        with httpx.Client(timeout=_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=False) as client:
            resp = client.get(url, headers={"User-Agent": _USER_AGENT})
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("Failed to download IG image %s: %s", url, e)
        return None
    except Exception as e:
        log.warning("Unexpected error downloading IG image %s: %s", url, e)
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
        log.warning("Failed to upload IG image %s -> bucket: %s", url, e)
        return None


def upload_post_images(image_urls: Iterable[str]) -> list[str]:
    """Upload each url in order; preserve list position by replacing failures with ``None`` then dropping.

    The extractor's ``image_index`` semantics depend on the carousel
    order, so we keep position by uploading each URL and dropping any
    that fail. Drops are logged at WARNING.
    """
    uploaded: list[str] = []
    for url in image_urls:
        if not url:
            continue
        result = upload_image_from_url(url)
        if result is not None:
            uploaded.append(result)
    return uploaded
