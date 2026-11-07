"""The storage service the vestigial scraper pipeline and Instagram publishing
still use (the API's uploads are stored by the Rust server)."""

from io import BytesIO
from unittest.mock import MagicMock

from PIL import Image

from services.storage_service import StorageService, storage


def test_validate_and_prepare_strips_exif_directly():
    """Service-level check: EXIF bytes don't survive validate_and_prepare."""
    buf = BytesIO()
    img = Image.new("RGB", (4, 4), color=(128, 128, 0))
    img.save(
        buf,
        format="JPEG",
        exif=(
            b"Exif\x00\x00"
            b"MM\x00*\x00\x00\x00\x08"
            b"\x00\x01"
            b"\x01\x0f\x00\x02\x00\x00\x00\x06"
            b"\x00\x00\x00\x1a"
            b"\x00\x00\x00\x00"
            b"LEAKED"
        ),
    )
    raw = buf.getvalue()
    assert b"LEAKED" in raw  # sanity
    cleaned, ct = storage.validate_and_prepare("avatars", raw, "image/jpeg")
    assert ct == "image/jpeg"
    assert b"LEAKED" not in cleaned


def test_path_from_url_rejects_traversal():
    """path_from_url returns None for URLs whose stored path contains ``..``.

    Without this, a user who PATCHes their event with
    ``source_image_url=".../event-images/../shared-asset.png"`` could cause
    an unrelated file to be deleted when they next upload (audit U10).
    """
    # Legitimate URL passes through.
    service = StorageService(
        MagicMock(),
        bucket_name="wat2do-test-media",
        public_base_url="https://media.wat2do.io",
    )

    ok = service.path_from_url(
        "https://media.wat2do.io/event-images/abc123.png",
        "event-images",
    )
    assert ok == "abc123.png"

    # Traversal is refused.
    bad = service.path_from_url(
        "https://media.wat2do.io/event-images/../shared.png",
        "event-images",
    )
    assert bad is None

    # Absolute path is refused.
    bad_abs = service.path_from_url(
        "https://media.wat2do.io/event-images//etc/passwd",
        "event-images",
    )
    assert bad_abs is None


def test_upload_file_writes_an_immutable_s3_object_at_its_public_url():
    s3 = MagicMock()
    service = StorageService(
        s3,
        bucket_name="wat2do-test-media",
        public_base_url="https://media.wat2do.io/",
    )

    url = service.upload_file("avatars", b"image-bytes", "image/png")

    assert url.startswith("https://media.wat2do.io/avatars/")
    assert url.endswith(".png")
    put = s3.put_object.call_args.kwargs
    assert put["Bucket"] == "wat2do-test-media"
    # The key is the public URL's path below STORAGE_PUBLIC_BASE_URL.
    assert url == f"https://media.wat2do.io/{put['Key']}"
    assert put == {
        "Bucket": "wat2do-test-media",
        "Key": put["Key"],
        "Body": b"image-bytes",
        "ContentType": "image/png",
        "CacheControl": "public, max-age=31536000, immutable",
    }


def test_storage_refuses_paths_outside_their_bucket():
    import pytest

    from core.exceptions import ValidationError

    s3 = MagicMock()
    service = StorageService(
        s3,
        bucket_name="wat2do-test-media",
        public_base_url="https://media.wat2do.io",
    )

    for bucket, path in [
        ("avatars", "../secret.jpg"),
        ("avatars", "/etc/passwd"),
        ("..", "secret.jpg"),
        ("unknown", "image.jpg"),
    ]:
        with pytest.raises(ValidationError, match="asset path"):
            service.download_file(bucket, path)
        service.delete_file(bucket, path)
    with pytest.raises(ValidationError, match="asset path"):
        service.upload_file("..", b"bytes", "image/png")
    assert s3.method_calls == []


def test_storage_requires_a_bucket_and_public_url():
    import pytest

    for bucket_name, public_base_url in (("", "https://media.wat2do.io"), ("media", "")):
        service = StorageService(
            MagicMock(), bucket_name=bucket_name, public_base_url=public_base_url
        )
        with pytest.raises(RuntimeError, match="STORAGE_BUCKET_NAME"):
            service.upload_file("avatars", b"bytes", "image/png")


def test_storage_client_uses_its_own_endpoint_and_keys(monkeypatch):
    import pytest

    import services.storage_service as storage_module

    for name, value in (
        ("storage_endpoint_url", "https://account.r2.cloudflarestorage.com"),
        ("storage_access_key_id", "storage-key"),
        ("storage_secret_access_key", "storage-secret"),
    ):
        monkeypatch.setattr(storage_module.settings, name, value)
    build = MagicMock()
    monkeypatch.setattr(storage_module.boto3, "client", build)

    StorageService(bucket_name="media", public_base_url="https://media.wat2do.io")._get_s3_client()

    kwargs = build.call_args.kwargs
    assert build.call_args.args == ("s3",)
    assert kwargs["endpoint_url"] == "https://account.r2.cloudflarestorage.com"
    assert kwargs["aws_access_key_id"] == "storage-key"
    assert kwargs["aws_secret_access_key"] == "storage-secret"
    assert kwargs["region_name"] == "auto"
    assert kwargs["config"].s3 == {"addressing_style": "path"}

    monkeypatch.setattr(storage_module.settings, "storage_secret_access_key", "")
    with pytest.raises(RuntimeError, match="STORAGE_SECRET_ACCESS_KEY"):
        StorageService(
            bucket_name="media", public_base_url="https://media.wat2do.io"
        )._get_s3_client()


def test_delete_file_deletes_only_the_expected_s3_key():
    s3 = MagicMock()
    service = StorageService(
        s3,
        bucket_name="wat2do-test-media",
        public_base_url="https://media.wat2do.io",
    )

    service.delete_file("avatars", "abc123.jpg")

    s3.delete_object.assert_called_once_with(
        Bucket="wat2do-test-media",
        Key="avatars/abc123.jpg",
    )
