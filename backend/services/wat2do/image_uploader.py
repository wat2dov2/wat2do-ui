"""Download Instagram images, hand them to the existing storage service.

v1 uploaded directly to S3. v2's storage layer is Supabase Storage, so
the scraper hands the bytes to ``services.storage_service`` which already
handles validation, EXIF stripping, and bucket selection
(``BUCKET_EVENT_IMAGES``).

Returned URLs are public (the bucket is set to public-read in the
``StorageService._DEFAULT_BUCKETS`` config) and cache-friendly.
"""

from __future__ import annotations

import logging
from typing import Iterable

import httpx

from core.constants import BUCKET_EVENT_IMAGES
from services.storage_service import storage

log = logging.getLogger(__name__)

# Instagram CDN occasionally rejects requests without a UA. Match what
# v1 used so we don't introduce a new failure mode in the port.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_DOWNLOAD_TIMEOUT_SECONDS = 60.0
# Map common content-type prefixes to a canonical MIME for the bucket
# allowlist. Storage validation does its own SVG/EXIF handling — we just
# pick the right declared MIME so the upload isn't rejected upfront.
_CONTENT_TYPE_FALLBACK = "image/jpeg"


def upload_image_from_url(url: str) -> str | None:
    """Fetch ``url`` from Instagram CDN, push to event-images bucket.

    Returns the public Supabase Storage URL on success, ``None`` on any
    failure. Failures are logged but never raised — the pipeline tolerates
    individual image upload errors and just drops that image from the
    list passed to the extractor.
    """
    try:
        with httpx.Client(timeout=_DOWNLOAD_TIMEOUT_SECONDS) as client:
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
            filename="instagram",
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
