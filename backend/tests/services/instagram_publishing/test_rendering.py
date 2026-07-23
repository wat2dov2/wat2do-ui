from io import BytesIO

import pytest
from PIL import Image

from services.instagram_publishing import rendering


def _event(event_id: int) -> dict[str, object]:
    return {
        "id": event_id,
        "title": f"Campus Event {event_id}",
        "category": "Games & Recreation",
        "organization": "Wat2Do Club",
        "ig_handle": "wat2do",
        "location": "Student Life Centre",
        "school": "uwaterloo",
        "source_image_url": f"https://example.com/{event_id}.jpg",
        "dtstart_utc": "2026-07-25T23:30:00+00:00",
    }


def _capture_upload(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    uploads: list[bytes] = []

    monkeypatch.setattr(
        rendering,
        "_download_image",
        lambda _url: Image.new("RGB", (640, 800), "#2B7FFF"),
    )
    monkeypatch.setattr(
        rendering.storage,
        "upload_file",
        lambda _bucket, payload, _content_type: (
            uploads.append(payload) or "https://asset.test/slide.png"
        ),
    )
    return uploads


def test_render_event_asset_uploads_instagram_portrait_png(monkeypatch: pytest.MonkeyPatch):
    uploads = _capture_upload(monkeypatch)

    assert rendering.render_event_asset(_event(1)) == "https://asset.test/slide.png"

    with Image.open(BytesIO(uploads[0])) as rendered:
        assert rendered.format == "PNG"
        assert rendered.size == (1080, 1350)


def test_render_cover_asset_uploads_instagram_portrait_png(monkeypatch: pytest.MonkeyPatch):
    uploads = _capture_upload(monkeypatch)

    assert rendering.render_cover_asset([_event(1), _event(2)], "uwaterloo") == (
        "https://asset.test/slide.png"
    )

    with Image.open(BytesIO(uploads[0])) as rendered:
        assert rendered.format == "PNG"
        assert rendered.size == (1080, 1350)


def test_download_image_rejects_non_supabase_hosts():
    with pytest.raises(ValueError, match="Supabase Storage"):
        rendering._download_image("https://example.com/poster.jpg")
