"""Storage via Supabase. Sync."""

import logging
import os
import uuid
from io import BytesIO

from core.constants import (
    BUCKET_AVATARS,
    BUCKET_CLUB_LOGOS,
    BUCKET_EVENT_IMAGES,
    BUCKET_QR_ASSETS,
    MAX_AVATAR_SIZE_BYTES,
    MAX_IMAGE_SIZE_BYTES,
)
from core.database import supabase_admin
from core.exceptions import ValidationError
from core.logging import logger
from core.retry import supabase_retry
from core.svg_sanitize import looks_like_svg, sanitize_svg

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
    BUCKET_EVENT_IMAGES: {
        "public": True,
        "file_size_limit": MAX_IMAGE_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
    BUCKET_AVATARS: {
        "public": True,
        "file_size_limit": MAX_AVATAR_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    },
    BUCKET_CLUB_LOGOS: {
        "public": True,
        "file_size_limit": MAX_AVATAR_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
    BUCKET_QR_ASSETS: {
        "public": True,
        "file_size_limit": MAX_IMAGE_SIZE_BYTES,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
}

_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


class StorageService:
    def __init__(self, storage_client, buckets: dict[str, dict] | None = None):
        self._storage = storage_client
        self.BUCKETS = buckets if buckets is not None else _DEFAULT_BUCKETS

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
        filename: str,
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

        # SVG detection: inspect actual file bytes, not the client-declared
        # Content-Type.  An attacker could upload a malicious SVG as
        # "image/png" to skip sanitization — so we check content regardless.
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

        # Client claims SVG but content is not actually SVG — reject.
        if content_type == "image/svg+xml":
            raise ValidationError("File declared as SVG but content is not valid SVG.")

        # Strip EXIF / XMP metadata from raster images so user-uploaded
        # photos don't leak GPS coordinates, device serials, or capture
        # timestamps (audit U9).  If Pillow can't decode the bytes, the
        # upload is rejected as invalid — a legitimate image always
        # round-trips through Pillow.
        if content_type in _EXIF_STRIP_MIMES:
            data = _strip_image_metadata(data, content_type)

        return data, content_type

    def ensure_buckets(self) -> dict[str, bool]:
        """Create all required storage buckets if they don't exist."""
        existing = {b.id for b in self._storage.list_buckets()}
        results: dict[str, bool] = {}

        for bucket_id, opts in self.BUCKETS.items():
            if bucket_id in existing:
                logger.info("Bucket '%s' already exists", bucket_id)
                results[bucket_id] = True
                continue
            try:
                self._storage.create_bucket(bucket_id, options=opts)
                logger.info("Created bucket '%s'", bucket_id)
                results[bucket_id] = True
            except Exception as e:
                logger.error("Failed to create bucket '%s': %s", bucket_id, e)
                results[bucket_id] = False

        return results

    @supabase_retry
    def upload_file(self, bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
        """Upload a file and return its public URL.

        The stored object's filename extension is derived exclusively from
        the *validated* ``content_type`` — the caller-supplied ``filename``
        is ignored for path construction.  This prevents the "upload as
        evil.html with Content-Type image/png" trick where the public
        URL ends in ``.html`` even though our MIME sniffer accepted the
        bytes (audit U7).  ``filename`` is still accepted in the
        signature for logging / call-site compatibility.
        """
        ext = _MIME_TO_EXT.get(content_type, ".bin")
        path = f"{uuid.uuid4().hex}{ext}"

        file_options: dict[str, str] = {"content-type": content_type}
        # For SVGs, force ``Content-Disposition: attachment`` so the
        # browser downloads the file instead of rendering it inline on a
        # top-level navigation.  Combined with the sanitizer this is
        # defense-in-depth — even if a bypass is found later, the file
        # won't execute scripts in the Supabase origin (audit U8).
        if content_type == "image/svg+xml":
            file_options["content-disposition"] = "attachment"

        self._storage.from_(bucket).upload(path, file_bytes, file_options=file_options)

        return self._storage.from_(bucket).get_public_url(path)

    def delete_file(self, bucket: str, path: str) -> None:
        """Delete a file by its path within a bucket.

        Rejects paths containing ``..`` or absolute path prefixes after
        normalization — prevents an attacker who controls
        ``source_image_url`` / ``logo_url`` / ``avatar_url`` from
        deleting unrelated objects in the same bucket via path
        traversal (audit U10).
        """
        if not _is_safe_storage_path(path):
            logger.warning("Refusing to delete suspicious path %s/%s", bucket, path)
            return
        try:
            self._storage.from_(bucket).remove([path])
        except Exception as e:
            logger.warning("Failed to delete %s/%s: %s", bucket, path, e)

    @staticmethod
    def path_from_url(url: str, bucket: str) -> str | None:
        """Extract the storage path from a public URL for deletion.

        Returns ``None`` for URLs that either (a) don't live under the
        expected bucket prefix or (b) contain suspicious traversal
        sequences.  The caller is expected to treat ``None`` as "leave
        the old object alone".
        """
        marker = f"/object/public/{bucket}/"
        idx = url.find(marker)
        if idx == -1:
            return None
        path = url[idx + len(marker) :]
        if not _is_safe_storage_path(path):
            return None
        return path


def _is_safe_storage_path(path: str) -> bool:
    """Return True if *path* is a plain bucket-relative filename.

    Rejects:
        - absolute paths ("/foo", "\\foo")
        - traversal via ``..``
        - empty / whitespace-only paths
    After normalization the path must not escape the bucket root — i.e.
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
    # normalized form — normpath alone will happily collapse ``a/../b``
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


def _strip_image_metadata(data: bytes, content_type: str) -> bytes:
    """Re-encode *data* through Pillow to drop EXIF, XMP, and other side-channel metadata.

    Raises ``ValidationError`` if the bytes cannot be decoded as an
    image of *content_type*.
    """
    try:
        # Pillow is imported lazily so the rest of the codebase (tests,
        # recommendations worker, etc.) doesn't need to pay the import
        # cost unless something actually uploads a raster image.
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:
        log.warning("Pillow not installed; skipping EXIF strip for %s", content_type)
        return data

    try:
        with Image.open(BytesIO(data)) as im:
            im.load()  # force decode to catch truncated files early
            # Build a fresh image from pixel data only — this discards
            # ``info`` (APP1/EXIF, XMP, iTXt/tEXt) without risking
            # metadata being re-attached by the encoder.
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
            elif pil_format == "GIF":
                # Preserve animation frames if present.
                if getattr(im, "is_animated", False):
                    save_kwargs["save_all"] = True
            im.save(out, format=pil_format, **save_kwargs)
            return out.getvalue()
    except Exception as exc:
        log.warning("Image metadata strip failed for %s: %s", content_type, exc)
        raise ValidationError("Uploaded file could not be decoded as a valid image.") from exc


storage = StorageService(supabase_admin.storage)
