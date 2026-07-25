from contextlib import contextmanager

import pytest

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


class _FakeResponse:
    def __init__(self, payload: bytes, content_type: str):
        self._payload = payload
        self.headers = {"content-type": content_type}

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self):
        yield self._payload


def _capture_render(
    monkeypatch: pytest.MonkeyPatch,
    *,
    payload: bytes = b"\x89PNG rendered",
    content_type: str = "image/png",
) -> tuple[list[dict], list[bytes]]:
    requests: list[dict] = []
    uploads: list[bytes] = []

    @contextmanager
    def fake_stream(method, url, *, json, headers, timeout, follow_redirects):
        requests.append({"method": method, "url": url, "json": json, "headers": headers})
        yield _FakeResponse(payload, content_type)

    monkeypatch.setattr(rendering.settings, "instagram_slide_render_url", "https://web.test/render")
    monkeypatch.setattr(rendering.settings, "instagram_slide_render_secret", "shared-secret")
    monkeypatch.setattr(rendering.httpx, "stream", fake_stream)
    monkeypatch.setattr(
        rendering.storage,
        "upload_file",
        lambda _bucket, uploaded, _content_type: (
            uploads.append(uploaded) or "https://asset.test/slide.png"
        ),
    )
    return requests, uploads


def test_render_event_asset_posts_the_event_and_uploads_the_png(monkeypatch: pytest.MonkeyPatch):
    requests, uploads = _capture_render(monkeypatch)

    assert rendering.render_event_asset(_event(1)) == "https://asset.test/slide.png"

    assert requests[0]["url"] == "https://web.test/render"
    assert requests[0]["json"]["kind"] == "event"
    assert requests[0]["json"]["event"]["id"] == 1
    assert requests[0]["json"]["school"] == "uwaterloo"
    assert requests[0]["headers"]["Authorization"] == "Bearer shared-secret"
    assert uploads[0] == b"\x89PNG rendered"


def test_render_cover_asset_posts_every_slide_event_and_the_body(monkeypatch: pytest.MonkeyPatch):
    requests, _ = _capture_render(monkeypatch)

    assert rendering.render_cover_asset([_event(1), _event(2)], "uwaterloo", "This week") == (
        "https://asset.test/slide.png"
    )

    assert requests[0]["json"]["kind"] == "cover"
    assert [event["id"] for event in requests[0]["json"]["events"]] == [1, 2]
    assert requests[0]["json"]["body"] == "This week"


def test_render_cover_asset_requires_at_least_one_event():
    with pytest.raises(ValueError, match="at least one event"):
        rendering.render_cover_asset([], "uwaterloo")


def test_render_rejects_a_non_png_response(monkeypatch: pytest.MonkeyPatch):
    _capture_render(monkeypatch, content_type="text/html")

    with pytest.raises(ValueError, match="did not return a PNG"):
        rendering.render_event_asset(_event(1))


def test_render_requires_a_configured_renderer(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(rendering.settings, "instagram_slide_render_url", "")

    with pytest.raises(ValueError, match="not configured"):
        rendering.render_event_asset(_event(1))
