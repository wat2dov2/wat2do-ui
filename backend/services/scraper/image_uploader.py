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

from core.constants import BUCKET_EVENT_IMAGES, BUCKET_EVENT_VIDEOS
from core.controlbox import controlbox
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
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return False
    try:
        if parsed.port is not None:
            return False
    except ValueError:
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


def upload_image_from_url(
    url: str,
    *,
    bucket: str,
    allow_all_domains: bool = False,
) -> str | None:
    """Fetch ``url``, validate its bytes, and push it to ``bucket``.

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
        prepared, prepared_content_type = storage.validate_and_prepare(
            bucket,
            resp.content,
            content_type,
        )
        return storage.upload_file(bucket, prepared, content_type=prepared_content_type)
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
        result = upload_image_from_url(
            url,
            bucket=BUCKET_EVENT_IMAGES,
            allow_all_domains=allow_all_domains,
        )
        if result is not None:
            uploaded.append(result)
    return uploaded


class MediaDownloadError(RuntimeError):
    """A safe explanation of why an Instagram media download failed."""


def download_video(url: object, *, maximum_bytes: int, timeout_seconds: int) -> bytes:
    """Download bounded MP4 bytes from the same trusted CDN as post images."""
    if not isinstance(url, str) or not url:
        raise MediaDownloadError("Instagram did not return a downloadable video for this post.")
    if not _is_safe_image_url(url):
        raise MediaDownloadError("Instagram returned an unsupported video host.")
    payload = bytearray()
    try:
        with httpx.stream(
            "GET",
            url,
            timeout=timeout_seconds,
            follow_redirects=False,
            headers={"User-Agent": _USER_AGENT},
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if content_type not in {"video/mp4", "application/octet-stream"}:
                raise MediaDownloadError("Instagram did not return an MP4 video.")
            for chunk in response.iter_bytes():
                if len(payload) + len(chunk) > maximum_bytes:
                    raise MediaDownloadError(
                        f"Video exceeds the {maximum_bytes:,}-byte media limit; use a smaller video."
                    )
                payload.extend(chunk)
    except httpx.HTTPError:
        raise MediaDownloadError(
            "Video download failed. Retry the command to obtain a fresh Instagram video link."
        ) from None
    if not payload:
        raise MediaDownloadError("Instagram returned an empty video.")
    return bytes(payload)


def upload_video_from_url(url: str) -> str | None:
    """Persist a retrieved video; failed video downloads retain the image poster."""
    try:
        data = download_video(
            url,
            maximum_bytes=controlbox.uploads.event_video_max_size_bytes,
            timeout_seconds=controlbox.uploads.event_video_download_timeout_seconds,
        )
        prepared, content_type = storage.validate_and_prepare(
            BUCKET_EVENT_VIDEOS, data, "video/mp4"
        )
        return storage.upload_file(BUCKET_EVENT_VIDEOS, prepared, content_type=content_type)
    except Exception:
        # Signed provider URLs and storage credentials must not reach workflow output.
        log.warning("Unable to persist Instagram video; retaining its image poster.")
        return None
