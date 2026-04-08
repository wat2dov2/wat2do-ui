"""Storage via Supabase. Sync."""

import uuid
from pathlib import PurePosixPath

from core.constants import (
    BUCKET_EVENT_IMAGES,
    BUCKET_AVATARS,
    BUCKET_CLUB_LOGOS,
    BUCKET_QR_ASSETS,
    MAX_AVATAR_SIZE_BYTES,
    MAX_IMAGE_SIZE_BYTES,
    supabase_retry,
)
from core.database import supabase_admin
from core.logging import logger


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
        """Upload a file and return its public URL."""
        ext = PurePosixPath(filename).suffix or _MIME_TO_EXT.get(content_type, ".bin")
        path = f"{uuid.uuid4().hex}{ext}"

        self._storage.from_(bucket).upload(
            path,
            file_bytes,
            file_options={"content-type": content_type},
        )

        return self._storage.from_(bucket).get_public_url(path)

    def delete_file(self, bucket: str, path: str) -> None:
        """Delete a file by its path within a bucket."""
        try:
            self._storage.from_(bucket).remove([path])
        except Exception as e:
            logger.warning("Failed to delete %s/%s: %s", bucket, path, e)

    @staticmethod
    def path_from_url(url: str, bucket: str) -> str | None:
        """Extract the storage path from a public URL for deletion."""
        marker = f"/object/public/{bucket}/"
        idx = url.find(marker)
        if idx == -1:
            return None
        return url[idx + len(marker):]


storage = StorageService(supabase_admin.storage)
