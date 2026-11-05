"""Event image thumbnails: the small WebP each poster gets when it is stored.

Event cards show the thumbnail instead of the poster, so nothing resizes images
at request time. ``StorageService.upload_file`` stores one next to every event
image, and ``scripts/make_event_image_thumbnails.py`` makes the missing ones for
files stored before; Rust's ``storage::make_thumbnail`` and ``storage::thumbnail_key``
mirror these functions.
"""

import logging
import posixpath
from io import BytesIO

from PIL import Image, ImageOps

from core.controlbox import controlbox
from core.exceptions import ValidationError

log = logging.getLogger(__name__)


def scale_to_width(im: Image.Image, width: int) -> Image.Image:
    """Return *im* scaled down to *width* wide, keeping its aspect ratio.

    A narrower image is left alone - enlarging one adds bytes without adding detail.
    """
    if im.width <= width:
        return im
    height = round(im.height * (width / im.width))
    return im.resize((width, max(height, 1)), Image.LANCZOS)


def event_image_thumbnail_path(path: str) -> str:
    """Return the thumbnail's path next to event image *path*.

    ``<uuid>.jpg`` becomes ``<uuid>.thumb.webp``. The frontend derives the same name from a poster URL, and Rust's
    ``storage::thumbnail_key`` from an object key.
    """
    return posixpath.splitext(path)[0] + controlbox.uploads.event_image_thumbnail_suffix


def make_event_image_thumbnail(data: bytes) -> bytes:
    """Encode the WebP thumbnail of an event image, at most the thumbnail width wide.

    An animated GIF's thumbnail is its first frame. Raises ``ValidationError``
    if the bytes cannot be decoded as an image.
    """
    uploads = controlbox.uploads
    try:
        with Image.open(BytesIO(data)) as im:
            # Opening leaves the first frame current; the encoder is given only it.
            frame = ImageOps.exif_transpose(im)
            has_alpha = "A" in frame.getbands() or "transparency" in frame.info
            frame = frame.convert("RGBA" if has_alpha else "RGB")
            frame = scale_to_width(frame, uploads.event_image_thumbnail_width_pixels)
            out = BytesIO()
            frame.save(out, format="WEBP", quality=uploads.event_image_thumbnail_quality)
            return out.getvalue()
    except Exception as exc:
        log.warning("Event image thumbnail failed: %s", exc)
        raise ValidationError("Uploaded file could not be decoded as a valid image.") from exc
