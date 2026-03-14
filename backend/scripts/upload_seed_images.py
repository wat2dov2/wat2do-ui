#!/usr/bin/env python3
"""
Upload seed images to Supabase Storage buckets.
Requires SUPABASE_SECRET_KEY in .env (bypasses RLS).
Downloads placeholder images and uploads to event-images, avatars, club-logos, qr-assets.
"""

import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

EVENT_IMAGE_COUNT = 30
AVATAR_COUNT = 12
LOGO_COUNT = 12


def get_storage():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("Add SUPABASE_SECRET_KEY to backend/.env (Supabase Dashboard > Settings > API Keys)")
        raise SystemExit(1)
    return create_client(url, key).storage


def download_image(url: str) -> bytes:
    with httpx.Client(follow_redirects=True) as client:
        r = client.get(url, timeout=30)
        r.raise_for_status()
        return r.content


def _public_url(project_url: str, bucket: str, path: str) -> str:
    project_url = project_url.rstrip("/")
    return f"{project_url}/storage/v1/object/public/{bucket}/{path}"


def main() -> None:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        print("SUPABASE_URL and SUPABASE_KEY required in .env")
        sys.exit(1)

    project_url = os.environ["SUPABASE_URL"]
    storage = get_storage()

    uploads: list[tuple[str, str, str]] = []  # (bucket, path, url)

    # Event images
    for i in range(1, EVENT_IMAGE_COUNT + 1):
        key = f"seed/event-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-event-{i:03d}/800/600"
        data = download_image(url)
        try:
            storage.from_("event-images").remove([key])
        except Exception:
            pass
        storage.from_("event-images").upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append(("event-images", key, _public_url(project_url, "event-images", key)))

    # Avatars
    for i in range(1, AVATAR_COUNT + 1):
        key = f"seed/avatar-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-avatar-{i:03d}/400/400"
        data = download_image(url)
        try:
            storage.from_("avatars").remove([key])
        except Exception:
            pass
        storage.from_("avatars").upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append(("avatars", key, _public_url(project_url, "avatars", key)))

    # Club logos (simple square images)
    for i in range(1, LOGO_COUNT + 1):
        key = f"seed/logo-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-logo-{i:03d}/200/200"
        data = download_image(url)
        try:
            storage.from_("club-logos").remove([key])
        except Exception:
            pass
        storage.from_("club-logos").upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append(("club-logos", key, _public_url(project_url, "club-logos", key)))

    # QR poster assets (reuse first N event images)
    for i in range(1, min(8, EVENT_IMAGE_COUNT) + 1):
        key = f"seed/poster-{i:03d}.jpg"
        url = f"https://picsum.photos/seed/wat2do-poster-{i:03d}/800/1000"
        data = download_image(url)
        try:
            storage.from_("qr-assets").remove([key])
        except Exception:
            pass
        storage.from_("qr-assets").upload(
            key, data, file_options={"content-type": "image/jpeg"}
        )
        uploads.append(("qr-assets", key, _public_url(project_url, "qr-assets", key)))

    for bucket, key, public_url in uploads:
        print(f"  {bucket}/{key} -> {public_url[:70]}...")

    print("\nDone. Seed images uploaded.")


if __name__ == "__main__":
    main()
