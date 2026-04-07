#!/usr/bin/env python3
"""
Upload seed images to Supabase Storage buckets.
Requires SUPABASE_SECRET_KEY in .env (bypasses RLS).
Downloads placeholder images and uploads to event-images, avatars, club-logos, qr-assets.
"""

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import settings
from core.constants import BUCKET_EVENT_IMAGES, BUCKET_AVATARS, BUCKET_CLUB_LOGOS, BUCKET_QR_ASSETS

EVENT_IMAGE_COUNT = 30
AVATAR_COUNT = 12
LOGO_COUNT = 12


def get_storage():
    from supabase import create_client
    if not settings.supabase_url or not settings.supabase_secret_key:
        print("Add SUPABASE_SECRET_KEY to backend/.env (Supabase Dashboard > Settings > API Keys)")
        raise SystemExit(1)
    return create_client(settings.supabase_url, settings.supabase_secret_key).storage


def download_image(url: str) -> bytes:
    with httpx.Client(follow_redirects=True) as client:
        r = client.get(url, timeout=30)
        r.raise_for_status()
        return r.content


def _public_url(project_url: str, bucket: str, path: str) -> str:
    return f"{project_url}/storage/v1/object/public/{bucket}/{path}"


def main() -> None:
    if not settings.supabase_url or not settings.supabase_key:
        print("SUPABASE_URL and SUPABASE_KEY required in .env")
        sys.exit(1)

    project_url = settings.supabase_url
    storage = get_storage()

    uploads: list[tuple[str, str, str]] = []  # (bucket, path, url)

    # Event images
    for i in range(1, EVENT_IMAGE_COUNT + 1):
        key = f"seed/event-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-event-{i:03d}/800/600"
        data = download_image(url)
        try:
            storage.from_(BUCKET_EVENT_IMAGES).remove([key])
        except Exception:
            pass
        storage.from_(BUCKET_EVENT_IMAGES).upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append((BUCKET_EVENT_IMAGES, key, _public_url(project_url, BUCKET_EVENT_IMAGES, key)))

    # Avatars
    for i in range(1, AVATAR_COUNT + 1):
        key = f"seed/avatar-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-avatar-{i:03d}/400/400"
        data = download_image(url)
        try:
            storage.from_(BUCKET_AVATARS).remove([key])
        except Exception:
            pass
        storage.from_(BUCKET_AVATARS).upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append((BUCKET_AVATARS, key, _public_url(project_url, BUCKET_AVATARS, key)))

    # Club logos (simple square images)
    for i in range(1, LOGO_COUNT + 1):
        key = f"seed/logo-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-logo-{i:03d}/200/200"
        data = download_image(url)
        try:
            storage.from_(BUCKET_CLUB_LOGOS).remove([key])
        except Exception:
            pass
        storage.from_(BUCKET_CLUB_LOGOS).upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append((BUCKET_CLUB_LOGOS, key, _public_url(project_url, BUCKET_CLUB_LOGOS, key)))

    # QR poster assets (reuse first N event images)
    for i in range(1, min(8, EVENT_IMAGE_COUNT) + 1):
        key = f"seed/poster-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-poster-{i:03d}/800/1000"
        data = download_image(url)
        try:
            storage.from_(BUCKET_QR_ASSETS).remove([key])
        except Exception:
            pass
        storage.from_(BUCKET_QR_ASSETS).upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append((BUCKET_QR_ASSETS, key, _public_url(project_url, BUCKET_QR_ASSETS, key)))

    for bucket, key, public_url in uploads:
        print(f"  {bucket}/{key} -> {public_url[:70]}...")

    print("\nDone. Seed images uploaded.")


if __name__ == "__main__":
    main()
