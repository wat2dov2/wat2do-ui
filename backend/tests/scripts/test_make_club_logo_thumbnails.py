"""The club logo thumbnail backfill, against a fake S3 that keeps its objects in memory."""

from io import BytesIO

import pytest
from botocore.exceptions import ClientError  # type: ignore[import-untyped]
from PIL import Image

from scripts import make_club_logo_thumbnails as script
from services.image_thumbnails import Thumbnail
from services.storage_service import StorageService


class FakeS3:
    """The S3 calls storage makes, answered from a dict of object keys to bytes."""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.listings: list[dict] = []
        self.reads: list[str] = []
        self.writes: list[dict] = []

    def get_paginator(self, operation: str):
        assert operation == "list_objects_v2"
        return self

    def paginate(self, *, Bucket: str, Prefix: str, Delimiter: str):
        self.listings.append({"Bucket": Bucket, "Prefix": Prefix, "Delimiter": Delimiter})
        keys = sorted(
            key
            for key in self.objects
            if key.startswith(Prefix) and Delimiter not in key[len(Prefix) :]
        )
        # Two keys a page, so the backfill has to read every page.
        for start in range(0, len(keys), 2):
            page = keys[start : start + 2]
            yield {"Contents": [{"Key": key, "Size": len(self.objects[key])} for key in page]}

    def get_object(self, *, Bucket: str, Key: str):
        self.reads.append(Key)
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "gone"}}, "GetObject")
        return {"Body": BytesIO(self.objects[Key]), "ContentType": "image/jpeg"}

    def put_object(self, **request):
        self.writes.append(request)
        self.objects[request["Key"]] = request["Body"]


def _image(width: int, height: int, image_format: str) -> bytes:
    out = BytesIO()
    Image.new("RGB", (width, height), "red").save(out, format=image_format)
    return out.getvalue()


@pytest.fixture
def media(monkeypatch):
    """Point the script's storage at a fake S3 holding *objects*."""

    def install(objects: dict[str, bytes]) -> FakeS3:
        s3 = FakeS3(objects)
        storage = StorageService(s3, bucket_name="media", public_base_url="https://media.wat2do.io")
        monkeypatch.setattr(script, "storage", storage)
        return s3

    return install


def test_each_raster_logo_without_a_thumbnail_gets_the_one_its_upload_would_store(media, capsys):
    logo = _image(1080, 1080, "JPEG")
    s3 = media(
        {
            "organization-logos/new.jpg": logo,
            "organization-logos/wide.png": _image(400, 200, "PNG"),
            "organization-logos/done.png": _image(10, 10, "PNG"),
            "organization-logos/done.thumb.webp": b"existing thumbnail",
            "organization-logos/vector.svg": b"<svg/>",
            "organization-logos/broken.webp": b"not an image",
            "organization-logos/nested/deep.jpg": logo,
            "event-images/poster.jpg": logo,
        }
    )

    assert script.main(["--workers", "2"]) == 1

    assert s3.listings == [{"Bucket": "media", "Prefix": "organization-logos/", "Delimiter": "/"}]
    made = {write["Key"]: write for write in s3.writes}
    assert sorted(made) == [
        "organization-logos/new.thumb.webp",
        "organization-logos/wide.thumb.webp",
    ]
    for write in made.values():
        assert write["Bucket"] == "media"
        assert write["ContentType"] == "image/webp"
        assert write["CacheControl"] == "public, max-age=31536000, immutable"
    assert made["organization-logos/new.thumb.webp"]["Body"] == Thumbnail.CLUB_LOGO.make(logo)
    with Image.open(BytesIO(made["organization-logos/wide.thumb.webp"]["Body"])) as small:
        assert small.format == "WEBP"
        assert small.size == (144, 72)
    assert s3.objects["organization-logos/done.thumb.webp"] == b"existing thumbnail"
    output = capsys.readouterr()
    assert output.out.strip() == (
        "5 logos: made 2 thumbnails, 1 already had one, 1 are SVGs, 1 failed"
    )
    assert "No thumbnail for broken.webp: ValidationError" in output.err

    # A rerun finds nothing left to make once the broken logo is gone.
    del s3.objects["organization-logos/broken.webp"]
    s3.writes.clear()
    assert script.main([]) == 0
    assert s3.writes == []
    assert capsys.readouterr().out.strip() == (
        "4 logos: made 0 thumbnails, 3 already had one, 1 are SVGs, 0 failed"
    )


def test_a_logo_deleted_after_the_listing_is_reported_and_the_rest_still_made(media, capsys):
    s3 = media({"organization-logos/kept.jpg": _image(300, 300, "JPEG")})
    s3.objects["organization-logos/deleted.jpg"] = b"listed, then deleted"
    original_get = s3.get_object

    def get_object(*, Bucket: str, Key: str):
        s3.objects.pop("organization-logos/deleted.jpg", None)
        return original_get(Bucket=Bucket, Key=Key)

    s3.get_object = get_object

    assert script.main(["--workers", "1"]) == 1

    assert [write["Key"] for write in s3.writes] == ["organization-logos/kept.thumb.webp"]
    output = capsys.readouterr()
    assert "made 1 thumbnails" in output.out
    assert "No thumbnail for deleted.jpg: ClientError" in output.err


def test_a_dry_run_only_lists_and_counts(media, capsys):
    logo = _image(1080, 1080, "JPEG")
    s3 = media(
        {
            "organization-logos/a.jpg": logo,
            "organization-logos/b.png": _image(10, 10, "PNG"),
            "organization-logos/b.thumb.webp": b"existing thumbnail",
            "organization-logos/c.svg": b"<svg/>",
        }
    )

    assert script.main(["--dry-run"]) == 0

    assert s3.reads == []
    assert s3.writes == []
    assert capsys.readouterr().out.strip() == (
        f"3 logos: 1 need a thumbnail ({len(logo) / 1_000_000:.1f} MB to download), "
        "1 already have one, 1 are SVGs"
    )
