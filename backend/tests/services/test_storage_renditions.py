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


def test_video_storage_validates_container_and_retains_mp4_content_type():
    from unittest.mock import MagicMock

    import pytest

    from core.constants import BUCKET_EVENT_VIDEOS
    from core.exceptions import ValidationError
    from services.storage_service import StorageService

    s3 = MagicMock()
    storage = StorageService(s3, bucket_name="test", public_base_url="https://wat2do.io/media")
    data = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42"
    prepared, content_type = storage.validate_and_prepare(BUCKET_EVENT_VIDEOS, data, "video/mp4")
    url = storage.upload_file(BUCKET_EVENT_VIDEOS, prepared, content_type)
    assert url.startswith("https://wat2do.io/media/event-videos/")
    assert url.endswith(".mp4")
    assert s3.put_object.call_args.kwargs["ContentType"] == "video/mp4"
    assert "ContentDisposition" not in s3.put_object.call_args.kwargs
    with pytest.raises(ValidationError, match="not an MP4"):
        storage.validate_and_prepare(BUCKET_EVENT_VIDEOS, b"<html>no video</html>", "video/mp4")


def test_owned_asset_download_is_bounded_and_closes_stream_on_failure():
    from io import BytesIO
    from unittest.mock import MagicMock

    import pytest

    from core.exceptions import ValidationError
    from services.storage_service import StorageService

    client = MagicMock()
    body = BytesIO(b"12345")
    client.get_object.return_value = {"Body": body, "ContentType": "image/jpeg"}
    storage = StorageService(
        client,
        bucket_name="test",
        public_base_url="https://wat2do.io/media",
        buckets={"event-images": {"file_size_limit": 4}},
    )
    with pytest.raises(ValidationError, match="media size limit"):
        storage.download_file("event-images", "original.jpg")
    assert body.closed
    for bucket, path in [("unknown", "image.jpg"), ("event-images", "../private")]:
        with pytest.raises(ValidationError, match="asset path"):
            storage.download_file(bucket, path)
    assert client.get_object.call_count == 1
