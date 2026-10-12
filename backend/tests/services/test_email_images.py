from io import BytesIO

import httpx
import pytest
from PIL import Image

from services.notifications import email_images

URL = "https://wat2do.io/media/event-images/poster"


def _poster(fmt: str, size: tuple[int, int]) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, "red").save(out, format=fmt)
    return out.getvalue()


def _serve(monkeypatch, content: bytes):
    monkeypatch.setattr(
        email_images.httpx,
        "get",
        lambda *_args, **_kwargs: httpx.Response(
            200, content=content, request=httpx.Request("GET", URL)
        ),
    )


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "GIF"])
def test_every_poster_format_becomes_a_square_jpeg(monkeypatch, fmt):
    _serve(monkeypatch, _poster(fmt, (800, 1000)))

    image = email_images.email_image(URL, "event-1", width=480, square=True)

    assert (image.content_id, image.filename, image.content_type) == (
        "event-1",
        "event-1.jpg",
        "image/jpeg",
    )
    with Image.open(BytesIO(image.content)) as embedded:
        assert (embedded.format, embedded.size) == ("JPEG", (480, 480))


def test_hero_keeps_its_shape_and_never_enlarges(monkeypatch):
    _serve(monkeypatch, _poster("PNG", (2400, 3000)))
    wide = email_images.email_image(URL, "event-image", width=1200, square=False)
    with Image.open(BytesIO(wide.content)) as embedded:
        assert embedded.size == (1200, 1500)

    _serve(monkeypatch, _poster("PNG", (300, 200)))
    small = email_images.email_image(URL, "event-image", width=1200, square=False)
    with Image.open(BytesIO(small.content)) as embedded:
        assert embedded.size == (300, 200)


def test_unusable_posters_fall_back_to_linking(monkeypatch):
    assert email_images.email_image(None, "event-1", width=480, square=True) is None

    _serve(monkeypatch, b"not an image")
    assert email_images.email_image(URL, "event-1", width=480, square=True) is None

    _serve(monkeypatch, b"x" * (email_images.controlbox.email_delivery.image_max_bytes + 1))
    assert email_images.email_image(URL, "event-1", width=480, square=True) is None

    def fail(*_args, **_kwargs):
        raise httpx.ConnectTimeout("slow")

    monkeypatch.setattr(email_images.httpx, "get", fail)
    assert email_images.email_image(URL, "event-1", width=480, square=True) is None
