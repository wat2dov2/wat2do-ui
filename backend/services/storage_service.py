"""Validated file storage in Cloudflare R2 through its S3 API, served publicly.

A file in bucket ``event-images`` named ``<uuid>.jpg`` is the object
``event-images/<uuid>.jpg`` in ``STORAGE_BUCKET_NAME`` and is served at
``$STORAGE_PUBLIC_BASE_URL/event-images/<uuid>.jpg``. Each object carries its
own response headers: the validated ``Content-Type``, an immutable
``Cache-Control`` and, for SVGs, ``Content-Disposition: attachment`` (audit U8).

Every event image and raster club logo also gets a small WebP thumbnail next
to it (``services.image_thumbnails``), which pages show wherever the image is
drawn small.
"""

import logging
import os
import uuid
from io import BytesIO
from urllib.parse import urlparse

import boto3  # type: ignore[import-untyped]
from botocore.config import Config  # type: ignore[import-untyped]

from core.config import settings
from core.constants import (
    BUCKET_AVATARS,
    BUCKET_CLAIM_PROOFS,
    BUCKET_CLUB_LOGOS,
    BUCKET_EVENT_IMAGES,
    BUCKET_EVENT_VIDEOS,
    BUCKET_QR_ASSETS,
    MAX_AVATAR_SIZE_BYTES,
    MAX_IMAGE_SIZE_BYTES,
)
from core.controlbox import controlbox
from core.exceptions import ValidationError
from core.logging import logger
from core.svg_sanitize import looks_like_svg, sanitize_svg
from services.image_thumbnails import Thumbnail, scale_to_width, thumbnail_path

log = logging.getLogger(__name__)

# MIME types whose bytes we re-encode through Pillow to strip EXIF / XMP
# metadata (GPS coordinates, device serial, capture timestamps, etc.)
# SVG metadata stripping happens inside ``sanitize_svg``.
_EXIF_STRIP_MIMES = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    }
)


_DEFAULT_BUCKETS: dict[str, dict] = {
    # The event image contract is shared verbatim with the frontend file picker,
    # so it lives in the control box rather than being restated here.
    BUCKET_EVENT_IMAGES: {
        "file_size_limit": controlbox.uploads.event_image_max_size_bytes,
        "allowed_mime_types": list(controlbox.uploads.event_image_allowed_mime_types),
    },
    BUCKET_EVENT_VIDEOS: {
        "file_size_limit": controlbox.uploads.event_video_max_size_bytes,
        "allowed_mime_types": ["video/mp4"],
    },
    BUCKET_AVATARS: {
        "file_size_limit": MAX_AVATAR_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    },
    BUCKET_CLUB_LOGOS: {
        "file_size_limit": MAX_AVATAR_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
    BUCKET_QR_ASSETS: {
        "file_size_limit": MAX_IMAGE_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
    BUCKET_CLAIM_PROOFS: {
        "file_size_limit": MAX_IMAGE_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    },
}

_MIME_TO_EXT = {
    "video/mp4": ".mp4",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


class StorageService:
    def __init__(
        self,
        s3_client=None,
        *,
        bucket_name: str | None = None,
        public_base_url: str | None = None,
        buckets: dict[str, dict] | None = None,
    ):
        self._s3 = s3_client
        self._bucket_name = bucket_name if bucket_name is not None else settings.storage_bucket_name
        configured_base_url = (
            public_base_url if public_base_url is not None else settings.storage_public_base_url
        )
        self._public_base_url = configured_base_url.rstrip("/")
        self.BUCKETS = buckets if buckets is not None else _DEFAULT_BUCKETS

    def _get_s3_client(self):
        if self._s3 is None:
            if not (
                settings.storage_endpoint_url
                and settings.storage_access_key_id
                and settings.storage_secret_access_key
            ):
                raise RuntimeError(
                    "S3 storage is not configured. Set STORAGE_ENDPOINT_URL, "
                    "STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY."
                )
            # Storage has its own endpoint and keys (R2 in production, the
            # local S3 server in development); SES keeps the AWS credentials.
            self._s3 = boto3.client(
                "s3",
                endpoint_url=settings.storage_endpoint_url,
                aws_access_key_id=settings.storage_access_key_id,
                aws_secret_access_key=settings.storage_secret_access_key,
                region_name="auto",
                config=Config(
                    s3={"addressing_style": "path"},
                    retries={"max_attempts": 4, "mode": "standard"},
                    # Checksums only where the API requires them, which R2 and
                    # the local server both accept.
                    request_checksum_calculation="when_required",
                    response_checksum_validation="when_required",
                ),
            )
        return self._s3

    def _require_configuration(self) -> None:
        if not self._bucket_name or not self._public_base_url:
            raise RuntimeError(
                "S3 storage is not configured. Set STORAGE_BUCKET_NAME and STORAGE_PUBLIC_BASE_URL."
            )

    def get_allowed_mime_types(self, bucket: str) -> list[str]:
        """Return the allowed MIME types for *bucket*, or an empty list."""
        return self.BUCKETS.get(bucket, {}).get("allowed_mime_types", [])

    def get_file_size_limit(self, bucket: str) -> int:
        """Return the file size limit for *bucket*, falling back to MAX_IMAGE_SIZE_BYTES."""
        return self.BUCKETS.get(bucket, {}).get("file_size_limit", MAX_IMAGE_SIZE_BYTES)

    def validate_and_prepare(
        self,
        bucket: str,
        data: bytes,
        content_type: str | None,
    ) -> tuple[bytes, str]:
        """Validate an upload against bucket rules and return cleaned data + final content type.

        Checks MIME type allowlist, file size limit, detects SVG content
        regardless of declared content type, sanitizes SVGs, and strips
        EXIF / XMP metadata from raster images.

        Raises ``ValidationError`` if the upload is invalid.
        """
        if not content_type:
            raise ValidationError("Missing content type")

        allowed = self.get_allowed_mime_types(bucket)
        if content_type not in allowed:
            raise ValidationError(
                f"File type {content_type} not allowed. Accepted: {', '.join(allowed)}"
            )

        limit = self.get_file_size_limit(bucket)
        if len(data) > limit:
            raise ValidationError(
                f"File too large. Max {limit // (1024 * 1024)} MB.",
                code="file_too_large",
            )

        if content_type == "video/mp4":
            # ISO base media files identify their container with an ftyp box.
            # Do not serve arbitrary HTML or bytes merely labelled video/mp4.
            if len(data) < 16 or data[4:8] != b"ftyp":
                raise ValidationError("Uploaded file is not an MP4 video.")
            return data, content_type

        # SVG detection: inspect actual file bytes, not the client-declared
        # Content-Type.  An attacker could upload a malicious SVG as
        # "image/png" to skip sanitization - so we check content regardless.
        is_svg = looks_like_svg(data)

        if is_svg:
            if "image/svg+xml" not in allowed:
                raise ValidationError(
                    "SVG content detected but SVG uploads are not allowed for this resource."
                )
            try:
                data = sanitize_svg(data)
            except ValueError as exc:
                log.warning("Invalid SVG upload for %s: %s", bucket, exc)
                raise ValidationError(f"Invalid SVG file: {exc}") from exc
            return data, "image/svg+xml"

        # Client claims SVG but content is not actually SVG - reject.
        if content_type == "image/svg+xml":
            raise ValidationError("File declared as SVG but content is not valid SVG.")

        # Strip EXIF / XMP metadata from raster images so user-uploaded
        # photos don't leak GPS coordinates, device serials, or capture
        # timestamps (audit U9).  If Pillow can't decode the bytes, the
        # upload is rejected as invalid - a legitimate image always
        # round-trips through Pillow.
        if content_type in _EXIF_STRIP_MIMES:
            # Event posters are also sized here. They are the only images this
            # app serves at scale, and resizing them once on the way in means
            # the request path can hand back a stored file instead of decoding
            # and resampling a full-size original for every viewer.
            max_width = (
                controlbox.uploads.event_image_rendition_width_pixels
                if bucket == BUCKET_EVENT_IMAGES
                else None
            )
            data = prepare_image_rendition(data, content_type, max_width=max_width)

        return data, content_type

    def upload_file(self, bucket: str, file_bytes: bytes, content_type: str) -> str:
        """Upload a file and return its public URL.

        The stored object's extension is derived exclusively from the
        *validated* ``content_type``.  This prevents the "upload as
        evil.html with Content-Type image/png" trick where the public URL ends
        in ``.html`` even though our MIME sniffer accepted the bytes (audit U7).

        An image's thumbnail is stored first, so a poster or logo is never
        published without the thumbnail its pages ask for.
        """
        ext = _MIME_TO_EXT.get(content_type, ".bin")
        self._require_configuration()
        path = f"{uuid.uuid4().hex}{ext}"
        key = self._object_key(bucket, path)
        if key is None:
            raise ValidationError("Invalid storage asset path")

        thumbnail = Thumbnail.of(bucket, path)
        if thumbnail is not None:
            self._put_thumbnail(bucket, path, thumbnail.make(file_bytes))
        self._put_object(key, file_bytes, content_type)

        return f"{self._public_base_url}/{bucket}/{path}"

    def make_thumbnail(self, bucket: str, path: str) -> None:
        """Make the thumbnail of stored image *path* and store it beside the image.

        It is the thumbnail the image's upload would have stored, for images
        stored before they got one. Raises ``ValidationError`` if *path* has no
        thumbnail or is not an image.
        """
        thumbnail = Thumbnail.of(bucket, path)
        if thumbnail is None:
            raise ValidationError(f"{bucket}/{path} has no thumbnail")
        data, _ = self.download_file(bucket, path)
        self._put_thumbnail(bucket, path, thumbnail.make(data))

    def _put_thumbnail(self, bucket: str, path: str, thumbnail: bytes) -> None:
        self._put_object(f"{bucket}/{thumbnail_path(path)}", thumbnail, "image/webp")

    def _put_object(self, key: str, body: bytes, content_type: str) -> None:
        put_options: dict[str, object] = {
            "Bucket": self._bucket_name,
            "Key": key,
            "Body": body,
            "ContentType": content_type,
            "CacheControl": "public, max-age=31536000, immutable",
        }
        # For SVGs, force ``Content-Disposition: attachment`` so the
        # browser downloads the file instead of rendering it inline on a
        # top-level navigation.  Combined with the sanitizer this is
        # defense-in-depth - even if a bypass is found later, the file
        # won't execute scripts in the storage origin (audit U8).
        if content_type == "image/svg+xml":
            put_options["ContentDisposition"] = "attachment"

        self._get_s3_client().put_object(**put_options)

    def download_file(self, bucket: str, path: str) -> tuple[bytes, str]:
        """Read one owned asset for repair through the same S3 configuration as uploads."""
        self._require_configuration()
        key = self._object_key(bucket, path)
        if key is None:
            raise ValidationError("Invalid storage asset path")
        response = self._get_s3_client().get_object(Bucket=self._bucket_name, Key=key)
        body = response["Body"]
        try:
            # Repairs must obey the same bounded media contract as new uploads.
            limit = self.get_file_size_limit(bucket)
            data = body.read(limit + 1)
            if len(data) > limit:
                raise ValidationError("Stored asset exceeds the configured media size limit")
            return data, response.get("ContentType", "")
        finally:
            body.close()

    def delete_file(self, bucket: str, path: str) -> None:
        """Delete a file by its path within a bucket, with its thumbnail if it has one.

        Rejects paths containing ``..`` or absolute path prefixes after
        normalization - prevents an attacker who controls
        ``source_image_url`` / ``logo_url`` / ``avatar_url`` from
        deleting unrelated objects via path traversal (audit U10).
        """
        self._require_configuration()
        key = self._object_key(bucket, path)
        if key is None:
            logger.warning("Refusing to delete suspicious path %s/%s", bucket, path)
            return
        keys = [key]
        if Thumbnail.of(bucket, path) is not None:
            keys.append(f"{bucket}/{thumbnail_path(path)}")
        for object_key in keys:
            try:
                self._get_s3_client().delete_object(Bucket=self._bucket_name, Key=object_key)
            except Exception as e:
                logger.warning("Failed to delete %s: %s", object_key, e)

    def path_from_url(self, url: str, bucket: str) -> str | None:
        """Extract the storage path from a public URL for deletion.

        Returns ``None`` for URLs that either (a) don't live under the
        expected bucket prefix or (b) contain suspicious traversal
        sequences.  The caller is expected to treat ``None`` as "leave
        the old object alone".
        """
        if not self._public_base_url:
            return None
        try:
            parsed = urlparse(url)
            base = urlparse(self._public_base_url)
        except ValueError:
            return None
        if parsed.scheme != base.scheme or parsed.netloc != base.netloc:
            return None
        marker = f"{base.path.rstrip('/')}/{bucket}/"
        if not parsed.path.startswith(marker):
            return None
        path = parsed.path[len(marker) :]
        if not _is_safe_storage_path(path):
            return None
        return path

    def list_files(self, bucket: str) -> dict[str, int]:
        """Return every file directly in *bucket*, by path, with its size in bytes."""
        self._require_configuration()
        if bucket not in self.BUCKETS:
            raise ValidationError("Invalid storage asset path")
        prefix = f"{bucket}/"
        pages = (
            self._get_s3_client()
            .get_paginator("list_objects_v2")
            .paginate(Bucket=self._bucket_name, Prefix=prefix, Delimiter="/")
        )
        return {
            item["Key"][len(prefix) :]: item["Size"]
            for page in pages
            for item in page.get("Contents", [])
        }

    def _object_key(self, bucket: str, path: str) -> str | None:
        """Return the S3 key of *bucket*/*path*, or None if it is not a plain file in a known bucket.

        Keys mirror public URLs: ``<bucket>/<file>`` under STORAGE_PUBLIC_BASE_URL.
        """
        if bucket not in self.BUCKETS or not _is_safe_storage_path(path):
            return None
        return f"{bucket}/{path}"


def _is_safe_storage_path(path: str) -> bool:
    """Return True if *path* is a plain bucket-relative filename.

    Rejects:
        - absolute paths ("/foo", "\\foo")
        - traversal via ``..``
        - empty / whitespace-only paths
    After normalization the path must not escape the bucket root - i.e.
    ``os.path.normpath`` must leave it alone (no ``..`` or ``.`` segments
    that would collapse).  This is a belt-and-suspenders check on top
    of the URL prefix match in ``path_from_url``.
    """
    if not path or not path.strip():
        return False
    # Reject absolute paths in either POSIX or Windows form.
    if path.startswith("/") or path.startswith("\\"):
        return False
    # Reject any traversal segment.  Check both the raw string and the
    # normalized form - normpath alone will happily collapse ``a/../b``
    # to ``b`` which isn't what we want.
    if ".." in path.split("/") or ".." in path.split("\\"):
        return False
    # After os.path.normpath collapses redundant separators, the result
    # should still be a plain relative path (no leading "..", no
    # absolute-root marker).  ``os.path.normpath("a/b")`` returns "a/b"
    # on POSIX and "a\\b" on Windows, so compare in platform-agnostic
    # form.
    normalized = os.path.normpath(path)
    if normalized.startswith("..") or os.path.isabs(normalized):
        return False
    return True


def prepare_image_rendition(
    data: bytes,
    content_type: str,
    *,
    max_width: int | None = None,
) -> bytes:
    """Re-encode *data* through Pillow to drop EXIF, XMP, and other metadata.

    When *max_width* is given, an image wider than it is scaled down to it in
    the same decode, preserving aspect ratio. Narrower images are left alone -
    enlarging one adds bytes without adding detail.

    Raises ``ValidationError`` if the bytes cannot be decoded as an
    image of *content_type*.
    """
    try:
        # Pillow is imported lazily so the rest of the codebase (tests,
        # jobs, etc.) doesn't need to pay the import cost unless something
        # actually uploads a raster image.
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:
        log.warning("Pillow not installed; skipping EXIF strip for %s", content_type)
        return data

    try:
        with Image.open(BytesIO(data)) as im:
            im.load()  # force decode to catch truncated files early
            # Build a fresh image from pixel data only - this discards
            # ``info`` (APP1/EXIF, XMP, iTXt/tEXt) without risking
            # metadata being re-attached by the encoder.
            # Animation is resized frame by frame or not at all; a single
            # resample would flatten it, so animated images keep their size.
            if max_width and not getattr(im, "is_animated", False):
                im = scale_to_width(im, max_width)

            pil_format = im.format
            if pil_format is None:
                # Fall back to the MIME-derived extension.
                pil_format = {
                    "image/jpeg": "JPEG",
                    "image/png": "PNG",
                    "image/webp": "WEBP",
                    "image/gif": "GIF",
                }.get(content_type, "PNG")

            out = BytesIO()
            save_kwargs: dict = {}
            # For formats that honour EXIF on save, pass an empty exif
            # block explicitly.  PNG/WEBP ignore ``exif=b""`` when it's
            # not present in ``im.info``; JPEG requires it.
            if pil_format == "JPEG":
                save_kwargs["exif"] = b""
                save_kwargs["optimize"] = True
                save_kwargs["quality"] = controlbox.uploads.event_image_rendition_quality
            elif pil_format == "GIF":
                # Preserve animation frames if present.
                if getattr(im, "is_animated", False):
                    save_kwargs["save_all"] = True
            im.save(out, format=pil_format, **save_kwargs)
            return out.getvalue()
    except Exception as exc:
        log.warning("Image metadata strip failed for %s: %s", content_type, exc)
        raise ValidationError("Uploaded file could not be decoded as a valid image.") from exc


storage = StorageService()
