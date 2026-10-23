from io import BytesIO
from unittest.mock import MagicMock

import pytest
from PIL import Image

from core.controlbox import controlbox
from schemas.school import SchoolRecord
from services import email_layout, school_logo_service

_POSTER_COLOR = (200, 30, 90)


def _png(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def silhouette() -> Image.Image:
    return school_logo_service.logo_silhouette(Image.open(school_logo_service.LOGO_ARTWORK_PATH))


def test_silhouette_keeps_inked_shapes_and_drops_white_details() -> None:
    artwork = Image.new("RGBA", (30, 10), (0, 0, 0, 0))
    artwork.paste((20, 80, 220, 255), (0, 0, 10, 10))
    artwork.paste((255, 255, 255, 255), (10, 0, 20, 10))

    mask = school_logo_service.logo_silhouette(artwork)

    assert [mask.getpixel((x, 5)) for x in (5, 15, 25)] == [255, 0, 0]


def test_poster_logo_fills_the_logo_with_posters_inside_an_outline(silhouette) -> None:
    logo = Image.open(
        BytesIO(
            school_logo_service.render_poster_logo(
                silhouette, [Image.new("RGB", (40, 50), _POSTER_COLOR)], seed="uwaterloo"
            )
        )
    ).convert("RGBA")

    control = controlbox.school_logos
    assert logo.size == (control.output_width, control.output_height)
    pixels = set(logo.get_flattened_data())
    assert logo.getpixel((0, 0))[3] == 0
    assert (*_POSTER_COLOR, 255) in pixels
    assert (255, 255, 255, 255) in pixels


def test_poster_logo_needs_a_poster(silhouette) -> None:
    with pytest.raises(ValueError, match="at least one poster"):
        school_logo_service.render_poster_logo(silhouette, [], seed="uwaterloo")


@pytest.fixture
def logo_storage(monkeypatch):
    storage = MagicMock()
    storage.upload_file.return_value = "https://wat2do.io/media/school-logos/new.png"
    storage.path_from_url.side_effect = lambda url, bucket: url.rsplit("/", 1)[-1]
    storage.download_file.return_value = (_png(Image.new("RGB", (40, 50), _POSTER_COLOR)), "")
    monkeypatch.setattr(school_logo_service, "storage", storage)
    return storage


def test_refresh_renders_busy_schools_and_clears_quiet_ones(
    monkeypatch, fake_sb, patch_sb, logo_storage
) -> None:
    patch_sb("services.school_logo_service")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 1,
                    "slug": "guelph",
                    "poster_logo_url": "https://wat2do.io/media/school-logos/old-g.png",
                },
                {
                    "id": 2,
                    "slug": "uwaterloo",
                    "poster_logo_url": "https://wat2do.io/media/school-logos/old-w.png",
                },
                {"id": 3, "slug": "carleton", "poster_logo_url": None},
            ]
        ]
    )
    counts = {1: 198, 2: 4804, 3: 50}
    monkeypatch.setattr(
        school_logo_service.school_service,
        "count_school_events",
        lambda school_id: counts[school_id],
    )
    monkeypatch.setattr(
        school_logo_service.school_service,
        "latest_school_poster_urls",
        lambda school_id, limit: ["https://wat2do.io/media/event-images/a.webp"],
    )

    results = school_logo_service.refresh_school_poster_logos()

    assert [(result.school, result.outcome, result.poster_logo_url) for result in results] == [
        ("guelph", "cleared", None),
        ("uwaterloo", "rendered", "https://wat2do.io/media/school-logos/new.png"),
        ("carleton", "unchanged", None),
    ]
    fake_sb.update.assert_any_call({"poster_logo_url": None})
    fake_sb.update.assert_any_call(
        {"poster_logo_url": "https://wat2do.io/media/school-logos/new.png"}
    )
    assert [call.args for call in logo_storage.delete_file.call_args_list] == [
        ("school-logos", "old-g.png"),
        ("school-logos", "old-w.png"),
    ]


def test_one_school_failing_does_not_stop_the_rest(
    monkeypatch, fake_sb, patch_sb, logo_storage
) -> None:
    patch_sb("services.school_logo_service")
    fake_sb.queue_responses(
        [
            [
                {"id": 1, "slug": "ubc", "poster_logo_url": None},
                {"id": 2, "slug": "sfu", "poster_logo_url": None},
            ]
        ]
    )

    def count(school_id: int) -> int:
        if school_id == 1:
            raise RuntimeError("database unavailable")
        return 10

    monkeypatch.setattr(school_logo_service.school_service, "count_school_events", count)

    results = school_logo_service.refresh_school_poster_logos()

    assert [(result.school, result.outcome) for result in results] == [
        ("ubc", "failed"),
        ("sfu", "unchanged"),
    ]


def test_email_logo_uses_the_schools_poster_logo(monkeypatch, logo_storage) -> None:
    school_logo_service.email_poster_logo.cache_clear()
    logo_storage.download_file.return_value = (
        _png(Image.new("RGBA", (713, 509), (*_POSTER_COLOR, 255))),
        "image/png",
    )
    record = MagicMock(
        spec=SchoolRecord, poster_logo_url="https://wat2do.io/media/school-logos/w.png"
    )
    monkeypatch.setattr(email_layout.school_service, "get_school", lambda slug: record)

    image = email_layout.email_logo("uwaterloo")

    assert image.content_id == "wat2do-logo"
    assert Image.open(BytesIO(image.content)).width == controlbox.school_logos.email_width


def test_email_logo_falls_back_to_the_standard_logo(monkeypatch, logo_storage) -> None:
    school_logo_service.email_poster_logo.cache_clear()
    logo_storage.download_file.side_effect = OSError("object missing")
    record = MagicMock(
        spec=SchoolRecord, poster_logo_url="https://wat2do.io/media/school-logos/w.png"
    )
    monkeypatch.setattr(email_layout.school_service, "get_school", lambda slug: record)
    standard = email_layout.email_logo(None)

    assert email_layout.email_logo("uwaterloo") == standard
