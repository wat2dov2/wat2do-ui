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
    storage = StorageService(s3, bucket_name="test", public_base_url="https://media.wat2do.io")
    data = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42"
    prepared, content_type = storage.validate_and_prepare(BUCKET_EVENT_VIDEOS, data, "video/mp4")
    url = storage.upload_file(BUCKET_EVENT_VIDEOS, prepared, content_type)
    assert url.startswith("https://media.wat2do.io/event-videos/")
    assert url.endswith(".mp4")
    assert s3.put_object.call_args.kwargs["Body"] == data
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
        public_base_url="https://media.wat2do.io",
        buckets={"event-images": {"file_size_limit": 4}},
    )
    with pytest.raises(ValidationError, match="media size limit"):
        storage.download_file("event-images", "original.jpg")
    client.get_object.assert_called_once_with(Bucket="test", Key="event-images/original.jpg")
    assert body.closed
    for bucket, path in [("unknown", "image.jpg"), ("event-images", "../private")]:
        with pytest.raises(ValidationError, match="asset path"):
            storage.download_file(bucket, path)
    assert client.get_object.call_count == 1


def _image_bytes(image, image_format: str, **save_kwargs) -> bytes:
    from io import BytesIO

    out = BytesIO()
    image.save(out, format=image_format, **save_kwargs)
    return out.getvalue()


def test_event_images_are_stored_with_a_webp_thumbnail_beside_them():
    """Cards show the thumbnail, so it is written before the poster it belongs to."""
    from io import BytesIO
    from unittest.mock import MagicMock

    from PIL import Image

    from core.constants import BUCKET_EVENT_IMAGES
    from core.controlbox import controlbox
    from services.storage_service import StorageService

    s3 = MagicMock()
    storage = StorageService(s3, bucket_name="media", public_base_url="https://media.wat2do.io")
    poster = _image_bytes(Image.new("RGB", (1080, 1350), "red"), "JPEG")

    url = storage.upload_file(BUCKET_EVENT_IMAGES, poster, "image/jpeg")

    name = url.removeprefix("https://media.wat2do.io/event-images/").removesuffix(".jpg")
    thumbnail, stored = (call.kwargs for call in s3.put_object.call_args_list)
    assert stored["Key"] == f"event-images/{name}.jpg"
    assert stored["Body"] == poster
    assert thumbnail["Key"] == f"event-images/{name}.thumb.webp"
    assert thumbnail["ContentType"] == "image/webp"
    assert thumbnail["CacheControl"] == "public, max-age=31536000, immutable"
    width = controlbox.uploads.event_image_thumbnail_width_pixels
    with Image.open(BytesIO(thumbnail["Body"])) as small:
        assert small.format == "WEBP"
        assert small.size == (width, round(1350 * width / 1080))


def test_videos_get_no_thumbnail_and_deleting_a_poster_deletes_its_thumbnail():
    from unittest.mock import MagicMock, call

    from core.constants import BUCKET_EVENT_IMAGES, BUCKET_EVENT_VIDEOS
    from services.storage_service import StorageService

    s3 = MagicMock()
    storage = StorageService(s3, bucket_name="media", public_base_url="https://media.wat2do.io")
    storage.upload_file(BUCKET_EVENT_VIDEOS, b"\x00\x00\x00\x18ftypisom", "video/mp4")
    assert s3.put_object.call_count == 1

    storage.delete_file(BUCKET_EVENT_IMAGES, "abc.png")
    storage.delete_file(BUCKET_EVENT_VIDEOS, "abc.mp4")
    assert s3.delete_object.call_args_list == [
        call(Bucket="media", Key="event-images/abc.png"),
        call(Bucket="media", Key="event-images/abc.thumb.webp"),
        call(Bucket="media", Key="event-videos/abc.mp4"),
    ]


def test_thumbnails_keep_transparency_small_sizes_and_a_gifs_first_frame():
    from io import BytesIO

    from PIL import Image

    from services.image_thumbnails import Thumbnail, thumbnail_path

    assert thumbnail_path("abc.jpg") == "abc.thumb.webp"
    assert thumbnail_path("abc.webp") == "abc.thumb.webp"

    clear = _image_bytes(Image.new("RGBA", (200, 100), (0, 0, 0, 0)), "PNG")
    with Image.open(BytesIO(Thumbnail.EVENT_IMAGE.make(clear))) as small:
        assert small.size == (200, 100)
        assert small.mode == "RGBA"

    frames = [Image.new("RGB", (800, 400), color) for color in ("red", "blue")]
    gif = _image_bytes(frames[0], "GIF", save_all=True, append_images=frames[1:], duration=100)
    with Image.open(BytesIO(Thumbnail.EVENT_IMAGE.make(gif))) as small:
        assert not getattr(small, "is_animated", False)
        assert small.width == 640
        red, green, blue = small.convert("RGB").getpixel((10, 10))
        assert red > 200 and blue < 50


def test_raster_club_logos_are_stored_with_a_small_webp_thumbnail_beside_them():
    """Logos are drawn at most 48 CSS px wide, so their thumbnail fits 144 px."""
    from io import BytesIO
    from unittest.mock import MagicMock

    from PIL import Image

    from core.constants import BUCKET_CLUB_LOGOS
    from services.storage_service import StorageService

    s3 = MagicMock()
    storage = StorageService(s3, bucket_name="media", public_base_url="https://media.wat2do.io")
    logo = _image_bytes(Image.new("RGB", (1080, 1080), "red"), "JPEG")

    url = storage.upload_file(BUCKET_CLUB_LOGOS, logo, "image/jpeg")

    name = url.removeprefix("https://media.wat2do.io/organization-logos/").removesuffix(".jpg")
    thumbnail, stored = (call.kwargs for call in s3.put_object.call_args_list)
    assert stored["Key"] == f"organization-logos/{name}.jpg"
    assert stored["Body"] == logo
    assert thumbnail["Key"] == f"organization-logos/{name}.thumb.webp"
    assert thumbnail["ContentType"] == "image/webp"
    assert thumbnail["CacheControl"] == "public, max-age=31536000, immutable"
    with Image.open(BytesIO(thumbnail["Body"])) as small:
        assert small.format == "WEBP"
        assert small.size == (144, 144)


def test_svg_logos_get_no_thumbnail_and_deleting_a_logo_deletes_its_thumbnail():
    from unittest.mock import MagicMock, call

    from core.constants import BUCKET_CLUB_LOGOS
    from services.storage_service import StorageService

    s3 = MagicMock()
    storage = StorageService(s3, bucket_name="media", public_base_url="https://media.wat2do.io")
    url = storage.upload_file(BUCKET_CLUB_LOGOS, b"<svg/>", "image/svg+xml")
    assert url.endswith(".svg")
    assert s3.put_object.call_count == 1

    storage.delete_file(BUCKET_CLUB_LOGOS, "abc.png")
    storage.delete_file(BUCKET_CLUB_LOGOS, "abc.svg")
    assert s3.delete_object.call_args_list == [
        call(Bucket="media", Key="organization-logos/abc.png"),
        call(Bucket="media", Key="organization-logos/abc.thumb.webp"),
        call(Bucket="media", Key="organization-logos/abc.svg"),
    ]


def test_logo_thumbnails_fit_their_longest_side_and_keep_transparency():
    from io import BytesIO

    from PIL import Image

    from core.constants import BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES, BUCKET_QR_ASSETS
    from services.image_thumbnails import Thumbnail

    assert Thumbnail.of(BUCKET_CLUB_LOGOS, "abc.png") is Thumbnail.CLUB_LOGO
    assert Thumbnail.of(BUCKET_CLUB_LOGOS, "abc.SVG") is None
    assert Thumbnail.of(BUCKET_EVENT_IMAGES, "abc.jpg") is Thumbnail.EVENT_IMAGE
    assert Thumbnail.of(BUCKET_QR_ASSETS, "abc.png") is None

    for size, fitted in [
        ((1080, 540), (144, 72)),
        ((600, 1200), (72, 144)),
        ((100, 50), (100, 50)),
    ]:
        image = _image_bytes(Image.new("RGB", size, "blue"), "PNG")
        with Image.open(BytesIO(Thumbnail.CLUB_LOGO.make(image))) as small:
            assert small.size == fitted

    clear = _image_bytes(Image.new("RGBA", (320, 320), (0, 0, 0, 0)), "PNG")
    with Image.open(BytesIO(Thumbnail.CLUB_LOGO.make(clear))) as small:
        assert small.size == (144, 144)
        assert small.mode == "RGBA"
