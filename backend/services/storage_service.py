import uuid
from pathlib import PurePosixPath

from core.database import supabase, supabase_admin
from core.logging import logger

_storage = (supabase_admin or supabase).storage

BUCKETS = {
    "event-images": {
        "public": True,
        "file_size_limit": 5 * 1024 * 1024,  # 5 MB
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
    "avatars": {
        "public": True,
        "file_size_limit": 2 * 1024 * 1024,  # 2 MB
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    },
    "club-logos": {
        "public": True,
        "file_size_limit": 2 * 1024 * 1024,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
    "qr-assets": {
        "public": True,
        "file_size_limit": 5 * 1024 * 1024,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
}


def ensure_buckets() -> dict[str, bool]:
    """Create all required storage buckets if they don't exist. Returns status per bucket."""
    existing = {b.id for b in _storage.list_buckets()}
    results: dict[str, bool] = {}

    for bucket_id, opts in BUCKETS.items():
        if bucket_id in existing:
            logger.info("Bucket '%s' already exists", bucket_id)
            results[bucket_id] = True
            continue
        try:
            _storage.create_bucket(bucket_id, options=opts)
            logger.info("Created bucket '%s'", bucket_id)
            results[bucket_id] = True
        except Exception as e:
            logger.error("Failed to create bucket '%s': %s", bucket_id, e)
            results[bucket_id] = False

    return results


def upload_file(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
    """Upload a file and return its public URL."""
    ext = PurePosixPath(filename).suffix or _ext_from_mime(content_type)
    path = f"{uuid.uuid4().hex}{ext}"

    _storage.from_(bucket).upload(
        path,
        file_bytes,
        file_options={"content-type": content_type},
    )

    return _storage.from_(bucket).get_public_url(path)


def delete_file(bucket: str, path: str) -> None:
    """Delete a file by its path within a bucket."""
    try:
        _storage.from_(bucket).remove([path])
    except Exception as e:
        logger.warning("Failed to delete %s/%s: %s", bucket, path, e)


def path_from_url(url: str, bucket: str) -> str | None:
    """Extract the storage path from a public URL for deletion."""
    marker = f"/object/public/{bucket}/"
    idx = url.find(marker)
    if idx == -1:
        return None
    return url[idx + len(marker):]


def _ext_from_mime(mime: str) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
    }
    return mapping.get(mime, ".bin")
