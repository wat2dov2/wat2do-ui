"""Event posters are sized when they are stored, not when they are served."""


def test_event_posters_are_stored_at_the_rendition_width():
    """A wide poster is scaled on the way in, so serving it needs no resizing."""
    from io import BytesIO

    from PIL import Image

    from core.constants import BUCKET_EVENT_IMAGES
    from core.controlbox import controlbox
    from services.storage_service import storage

    max_width = controlbox.uploads.event_image_rendition_width_pixels
    source = BytesIO()
    Image.new("RGB", (max_width * 2, max_width), "red").save(source, format="JPEG")

    cleaned, content_type = storage.validate_and_prepare(
        BUCKET_EVENT_IMAGES, source.getvalue(), "image/jpeg"
    )

    with Image.open(BytesIO(cleaned)) as stored:
        assert stored.width == max_width
        # Aspect ratio survives: the source was twice as wide as it was tall.
        assert stored.height == max_width // 2
    assert content_type == "image/jpeg"


def test_a_poster_narrower_than_the_rendition_width_is_left_alone():
    """Enlarging adds bytes without adding detail, so small images pass through."""
    from io import BytesIO

    from PIL import Image

    from core.constants import BUCKET_EVENT_IMAGES
    from services.storage_service import storage

    source = BytesIO()
    Image.new("RGB", (320, 240), "blue").save(source, format="JPEG")

    cleaned, _ = storage.validate_and_prepare(BUCKET_EVENT_IMAGES, source.getvalue(), "image/jpeg")

    with Image.open(BytesIO(cleaned)) as stored:
        assert stored.size == (320, 240)
