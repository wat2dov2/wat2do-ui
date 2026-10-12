"""Posters re-encoded as small JPEGs and carried inside notification emails.

Outlook blocks remote images from unfamiliar senders and cannot show WebP, so
every poster is downloaded, resized, and embedded as a JPEG. Any failure
returns None and the caller links the original URL instead.
"""

import logging
from io import BytesIO

import httpx
from PIL import Image, ImageOps

from core.controlbox import controlbox
from services.email_service import InlineImage

log = logging.getLogger(__name__)


def email_image(
    url: str | None, content_id: str, *, width: int, square: bool
) -> InlineImage | None:
    """Download *url* and return it as an embeddable JPEG, or None to link it instead.

    ``square`` center-crops like the app's event grid; otherwise the poster keeps
    its shape and is only narrowed to ``width``.
    """
    if not url:
        return None
    control = controlbox.email_delivery
    try:
        response = httpx.get(url, timeout=control.image_timeout_seconds, follow_redirects=True)
        response.raise_for_status()
        if len(response.content) > control.image_max_bytes:
            return None
        with Image.open(BytesIO(response.content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        if square:
            image = ImageOps.fit(image, (width, width), Image.LANCZOS)
        elif image.width > width:
            image = image.resize(
                (width, max(round(image.height * width / image.width), 1)), Image.LANCZOS
            )
        out = BytesIO()
        image.save(out, format="JPEG", quality=control.image_quality, optimize=True)
    except Exception:
        log.warning("Could not prepare image for embedding: %s", url, exc_info=True)
        return None
    return InlineImage(
        content_id=content_id,
        filename=f"{content_id}.jpg",
        content_type="image/jpeg",
        content=out.getvalue(),
    )
