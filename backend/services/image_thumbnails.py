"""Image thumbnails: the small WebP stored beside each event poster and raster club logo.

Pages show the thumbnail wherever the image is drawn small (poster frames, and
club logos at 64 CSS px or less), so nothing resizes images at request time.
``StorageService.upload_file`` stores one beside every such image, and
``scripts/make_event_image_thumbnails.py`` and ``scripts/make_club_logo_thumbnails.py``
make the missing ones for files stored before; Rust's ``storage::Thumbnail`` and
``storage::thumbnail_key`` mirror this module.
"""

import logging
import posixpath
from enum import Enum
from io import BytesIO

from PIL import Image, ImageOps

from core.constants import BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES
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


def scale_to_fit(im: Image.Image, size: int) -> Image.Image:
    """Return *im* scaled down so neither side is longer than *size*, keeping its aspect ratio.

    A smaller image is left alone.
    """
    if im.height <= im.width:
        return scale_to_width(im, size)
    if im.height <= size:
        return im
    width = round(im.width * (size / im.height))
    return im.resize((max(width, 1), size), Image.LANCZOS)


def thumbnail_path(path: str) -> str:
    """Return the path of the thumbnail stored next to image *path*.

    ``<uuid>.jpg`` becomes ``<uuid>.thumb.webp``. The frontend derives the same name from an
    image URL, and Rust's ``storage::thumbnail_key`` from an object key.
    """
    return posixpath.splitext(path)[0] + controlbox.uploads.thumbnail_suffix


class Thumbnail(Enum):
    """The thumbnail an image is stored with, if any."""

    # A poster's, at most the event image thumbnail width wide, for poster frames.
    EVENT_IMAGE = "event_image"
    # A raster club logo's, at most the club logo thumbnail size on its longest
    # side, for logos drawn at 64 CSS px or less.
    CLUB_LOGO = "club_logo"

    @classmethod
    def of(cls, bucket: str, path: str) -> "Thumbnail | None":
        """Return the thumbnail stored beside *path* in *bucket*, or None if it has none.

        SVG logos are small already, so they have none.
        """
        if bucket == BUCKET_EVENT_IMAGES:
            return cls.EVENT_IMAGE
        if bucket == BUCKET_CLUB_LOGOS and not path.lower().endswith(".svg"):
            return cls.CLUB_LOGO
        return None

    def make(self, data: bytes) -> bytes:
        """Encode the WebP thumbnail of an image's bytes.

        An animated image's thumbnail is its first frame. Raises ``ValidationError``
        if the bytes cannot be decoded as an image.
        """
        uploads = controlbox.uploads
        try:
            with Image.open(BytesIO(data)) as im:
                # Opening leaves the first frame current; the encoder is given only it.
                frame = ImageOps.exif_transpose(im)
                has_alpha = "A" in frame.getbands() or "transparency" in frame.info
                frame = frame.convert("RGBA" if has_alpha else "RGB")
                if self is Thumbnail.EVENT_IMAGE:
                    frame = scale_to_width(frame, uploads.event_image_thumbnail_width_pixels)
                    quality = uploads.event_image_thumbnail_quality
                else:
                    frame = scale_to_fit(frame, uploads.club_logo_thumbnail_size_pixels)
                    quality = uploads.club_logo_thumbnail_quality
                out = BytesIO()
                frame.save(out, format="WEBP", quality=quality)
                return out.getvalue()
        except Exception as exc:
            log.warning("Image thumbnail failed: %s", exc)
            raise ValidationError("Uploaded file could not be decoded as a valid image.") from exc
