"""Carousel slide rasterization.

Slides are HTML templates that live in the frontend
(``src/features/admin/components/instagram/slides``) and are rasterized by
satori. This module is the thin backend side of that contract: it posts live
event data to the Next.js render route at publish time and stores the PNG it
returns. Nothing is rendered before then - the admin editor previews the app's
own event card, not the poster.
"""

from __future__ import annotations

from typing import Any

import httpx

from core.config import settings
from core.constants import BUCKET_EVENT_IMAGES
from services.storage_service import storage

_MAX_RENDERED_IMAGE_BYTES = 15 * 1024 * 1024


def render_event_asset(event: dict[str, Any]) -> str:
    """Render and upload one Instagram carousel slide for a single event."""
    return _upload_png(_render({"kind": "event", "event": event, "school": event.get("school")}))


def render_cover_asset(events: list[dict[str, Any]], school: str, body: str = "") -> str:
    """Render and upload the cover slide compiled from the selected events."""
    if not events:
        raise ValueError("at least one event is required to render a cover")
    return _upload_png(_render({"kind": "cover", "events": events, "school": school, "body": body}))


def _render(slide: dict[str, Any]) -> bytes:
    url = settings.instagram_slide_render_url.strip()
    if not url:
        raise ValueError("Instagram slide renderer URL is not configured")

    headers = {"Accept": "image/png"}
    secret = settings.instagram_slide_render_secret.strip()
    if secret:
        headers["Authorization"] = f"Bearer {secret}"

    payload = bytearray()
    with httpx.stream(
        "POST",
        url,
        json=slide,
        headers=headers,
        timeout=settings.instagram_slide_render_timeout,
        follow_redirects=False,
    ) as response:
        response.raise_for_status()
        if not (response.headers.get("content-type") or "").lower().startswith("image/png"):
            raise ValueError("Instagram slide renderer did not return a PNG")
        for chunk in response.iter_bytes():
            payload.extend(chunk)
            if len(payload) > _MAX_RENDERED_IMAGE_BYTES:
                raise ValueError("Instagram slide renderer returned an oversized image")

    if not payload:
        raise ValueError("Instagram slide renderer returned an empty image")
    return bytes(payload)


def _upload_png(payload: bytes) -> str:
    return storage.upload_file(BUCKET_EVENT_IMAGES, payload, "image/png")
