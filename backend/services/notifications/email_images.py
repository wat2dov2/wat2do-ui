"""Event posters re-encoded as JPEGs and carried inside event change emails.

Outlook blocks remote images from unfamiliar senders and cannot show WebP, so
the poster is downloaded, narrowed, and embedded as a JPEG. Any failure
returns None and the caller links the original URL instead.

The scheduled emails embed their images in Rust
(`rust/src/notifications/email_images.rs`), which resamples the same way.
"""

import logging
from io import BytesIO

import httpx
from PIL import Image, ImageOps

from core.controlbox import controlbox
from services.email_service import InlineImage

log = logging.getLogger(__name__)


def event_hero_image(url: str | None) -> InlineImage | None:
    """The full-width poster at the top of single-event emails, never enlarged."""
    if not url:
        return None
    control = controlbox.email_delivery
    width = control.hero_image_px
    try:
        response = httpx.get(url, timeout=control.image_timeout_seconds, follow_redirects=True)
        response.raise_for_status()
        if len(response.content) > control.image_max_bytes:
            return None
        with Image.open(BytesIO(response.content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        if image.width > width:
            image = image.resize(
                (width, max(round(image.height * width / image.width), 1)), Image.LANCZOS
            )
        out = BytesIO()
        image.save(out, format="JPEG", quality=control.image_quality, optimize=True)
    except Exception:
        log.warning("Could not prepare image for embedding: %s", url, exc_info=True)
        return None
    return InlineImage(
        content_id="event-image",
        filename="event-image.jpg",
        content_type="image/jpeg",
        content=out.getvalue(),
    )
