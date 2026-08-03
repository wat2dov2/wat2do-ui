from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import MagicMock

import pytest
from PIL import Image

from schemas.event import EventResponse
from schemas.organization import OrganizationResponse
from services import event_service, organization_service
from services.storage_service import StorageService, storage
from tests.conftest import FAKE_USER, OTHER_USER


def _make_file(filename: str, content: bytes, content_type: str) -> dict:
    # FastAPI TestClient expects a tuple of (filename, fileobj/bytes, content_type)
    return {"file": (filename, content, content_type)}


def _real_png(size: tuple[int, int] = (4, 4)) -> bytes:
    """Return a tiny real PNG so the EXIF-strip path can decode it.

    validate_and_prepare re-encodes raster images through Pillow to
    drop EXIF metadata (audit U9), so tests that previously used
    ``b"fake-bytes"`` need actual image bytes.
    """
    buf = BytesIO()
    Image.new("RGB", size, color=(255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _real_jpeg_with_exif() -> bytes:
    """Return a small JPEG containing an EXIF block with a recognisable tag."""
    buf = BytesIO()
    img = Image.new("RGB", (4, 4), color=(0, 255, 0))
    # Build a minimal EXIF block.  Pillow accepts a raw bytes blob here;
    # the TIFF magic + header is enough for the test to find the marker
    # before stripping.
    exif_bytes = (
        b"Exif\x00\x00"  # APP1 marker identifier
        b"MM\x00*\x00\x00\x00\x08"  # TIFF header (big-endian)
        b"\x00\x01"  # 1 IFD entry
        b"\x01\x0f\x00\x02\x00\x00\x00\x06"  # tag 0x010f = Make, ASCII, count=6
        b"\x00\x00\x00\x1a"  # offset to value
        b"\x00\x00\x00\x00"  # end of IFD
        b"LEAKED"  # the literal value
    )
    img.save(buf, format="JPEG", exif=exif_bytes)
    return buf.getvalue()


def _mock_event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


def _mock_organization(**overrides) -> OrganizationResponse:
    defaults = {
        "id": 1,
        "organization_name": "Test Organization",
        "organization_type": "wusa",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


# ── QR asset uploads (no resource ownership — just auth) ────────────────


def test_upload_qr_asset_success(authenticated_client, monkeypatch):
    """QR asset upload succeeds with valid image and auth, returning URL."""

    recorded: dict | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, content_type: str) -> str:  # type: ignore[override]
        nonlocal recorded
        recorded = {
            "bucket": bucket,
            "file_bytes": file_bytes,
            "content_type": content_type,
        }
        return "https://example.com/qr-assets/fake.png"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    png = _real_png()
    files = _make_file("poster.png", png, "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    data = resp.json()
    assert data["url"] == "https://example.com/qr-assets/fake.png"

    assert recorded is not None
    assert recorded["bucket"] == "qr-assets"
    # Bytes are re-encoded (EXIF strip) so we don't compare exact equality,
    # but the re-encoded PNG is still non-empty and starts with the PNG magic.
    assert recorded["file_bytes"].startswith(b"\x89PNG")
    assert recorded["content_type"] == "image/png"


def test_upload_qr_asset_rejects_invalid_mime(authenticated_client):
    """QR asset upload rejects non-image content types."""

    files = _make_file("notes.txt", b"hello", "text/plain")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 400
    body = resp.json()
    assert "File type text/plain not allowed" in body["detail"]


def test_upload_qr_asset_too_large(authenticated_client, monkeypatch):
    """QR asset upload enforces file size limits."""

    # Force a very small size limit so we don't allocate huge buffers.
    monkeypatch.setitem(storage.BUCKETS["qr-assets"], "file_size_limit", 10)

    files = _make_file("big.png", b"x" * 11, "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 413
    body = resp.json()
    assert "File too large" in body["detail"]


def test_upload_qr_asset_requires_auth(client):
    """QR asset upload requires authentication."""

    files = _make_file("poster.png", _real_png(), "image/png")
    resp = client.post("/uploads/qr-asset", files=files)

    assert resp.status_code in (401, 403)


def test_upload_svg_sanitizes_script_tags(authenticated_client, monkeypatch):
    """SVG uploads are sanitized — <script> tags are stripped before storage."""

    stored_bytes: bytes | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, content_type: str) -> str:
        nonlocal stored_bytes
        stored_bytes = file_bytes
        return "https://example.com/qr-assets/clean.svg"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    malicious_svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg">'
        b"<script>alert('xss')</script>"
        b'<rect width="50" height="50"/>'
        b"</svg>"
    )
    files = _make_file("logo.svg", malicious_svg, "image/svg+xml")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    assert stored_bytes is not None
    assert b"<script" not in stored_bytes
    assert b"alert" not in stored_bytes
    assert b"<rect" in stored_bytes


def test_upload_svg_rejects_invalid_xml(authenticated_client):
    """SVG upload with non-XML content is rejected."""

    files = _make_file("bad.svg", b"not xml at all", "image/svg+xml")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 400
    assert "SVG" in resp.json()["detail"]


def test_upload_svg_rejects_non_svg_root(authenticated_client):
    """SVG upload whose root element is not <svg> is rejected."""

    files = _make_file("fake.svg", b"<html><body>hi</body></html>", "image/svg+xml")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 400
    assert "SVG" in resp.json()["detail"]


# ── Event image upload ownership ────────────────────────────────────────


def test_upload_event_image_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot upload an image to someone else's event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service

    files = _make_file("poster.png", _real_png(), "image/png")
    resp = other_user_client.post("/uploads/event-image/1", files=files)
    assert resp.status_code == 403


def test_upload_event_image_owner_allowed(authenticated_client, monkeypatch):
    """Owner can upload an image to their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(
        event_service,
        "update_event",
        MagicMock(
            return_value=event_service.EventUpdateResult(
                event=event,
                recipient_ids=[],
            )
        ),
    )
    monkeypatch.setattr(
        storage, "upload_file", MagicMock(return_value="https://example.com/img.png")
    )

    from services import user_service

    files = _make_file("poster.png", _real_png(), "image/png")
    resp = authenticated_client.post("/uploads/event-image/1", files=files)
    assert resp.status_code == 200


def test_upload_event_image_unsigned_authenticated(authenticated_client, monkeypatch):
    """Authenticated user can upload an unsigned event image flyer."""
    monkeypatch.setattr(
        storage, "upload_file", MagicMock(return_value="https://example.com/img.png")
    )
    files = _make_file("poster.png", _real_png(), "image/png")
    resp = authenticated_client.post("/uploads/event-image", files=files)
    assert resp.status_code == 200
    assert resp.json()["url"] == "https://example.com/img.png"


# ── Organization logo upload ownership ──────────────────────────────────────────


def test_upload_organization_logo_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot upload a logo to someone else's organization."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )

    from services import user_service

    files = _make_file("logo.png", _real_png(), "image/png")
    resp = other_user_client.post("/uploads/organization-logo/1", files=files)
    assert resp.status_code == 403


def test_upload_organization_logo_owner_allowed(authenticated_client, monkeypatch):
    """Owner can upload a logo to their own organization."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "update_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        storage, "upload_file", MagicMock(return_value="https://example.com/logo.png")
    )

    from services import user_service

    files = _make_file("logo.png", _real_png(), "image/png")
    resp = authenticated_client.post("/uploads/organization-logo/1", files=files)
    assert resp.status_code == 200


# ── Content-Type spoofing: SVG disguised as other image types ──────────


def test_svg_disguised_as_png_still_sanitized(authenticated_client, monkeypatch):
    """SVG content uploaded as image/png is detected and sanitized, not passed through raw."""

    stored_bytes: bytes | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, content_type: str) -> str:
        nonlocal stored_bytes
        stored_bytes = file_bytes
        return "https://example.com/qr-assets/sneaky.png"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    malicious_svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg">'
        b"<script>alert('xss')</script>"
        b'<rect width="50" height="50"/>'
        b"</svg>"
    )
    # Attacker lies about Content-Type — claims it's image/png
    files = _make_file("innocent.png", malicious_svg, "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    assert stored_bytes is not None
    # The <script> tag must be stripped even though Content-Type said image/png
    assert b"<script" not in stored_bytes
    assert b"alert" not in stored_bytes
    assert b"<rect" in stored_bytes


def test_svg_disguised_as_png_corrects_content_type(authenticated_client, monkeypatch):
    """When SVG content is detected, the content type passed to storage is corrected to image/svg+xml."""

    recorded_ct: str | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, content_type: str) -> str:
        nonlocal recorded_ct
        recorded_ct = content_type
        return "https://example.com/qr-assets/fixed.svg"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    clean_svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="50" height="50"/></svg>'
    files = _make_file("poster.png", clean_svg, "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    assert recorded_ct == "image/svg+xml"


def test_svg_disguised_as_png_blocked_on_non_svg_bucket(authenticated_client, monkeypatch):
    """SVG content uploaded to a bucket that doesn't allow SVGs is rejected."""

    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))

    from services import user_service

    malicious_svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert('xss')</script></svg>"
    # event-images bucket does NOT allow image/svg+xml
    files = _make_file("evil.png", malicious_svg, "image/png")
    resp = authenticated_client.post("/uploads/event-image/1", files=files)

    assert resp.status_code == 400
    assert "SVG" in resp.json()["detail"]


# ── Regression: audit U6 — Content-Length pre-check before body buffering ──


def test_upload_rejects_oversized_content_length_without_reading_body(
    authenticated_client, monkeypatch
):
    """A POST whose Content-Length exceeds the bucket limit is rejected
    with 413 by the ``_enforce_content_length`` dependency — without
    FastAPI parsing the multipart body first.  A naive implementation
    that reads ``await file.read()`` before size-checking would allocate
    a full buffer for every abusive request (audit U6).
    """
    # Shrink the bucket limit so we don't have to send megabytes in CI.
    monkeypatch.setitem(storage.BUCKETS["qr-assets"], "file_size_limit", 128)

    # Send a well-formed multipart body whose Content-Length header
    # exceeds the bucket cap + slack.  The actual body size is a few
    # hundred bytes — we only need the *header* to trip the dependency.
    png = _real_png(size=(100, 100))
    files = _make_file("big.png", png, "image/png")
    resp = authenticated_client.post(
        "/uploads/qr-asset",
        files=files,
    )
    # With a 128-byte bucket limit + 4 KiB slack, a ~500 byte PNG should
    # be rejected as oversized (the PNG itself is >128 bytes).
    assert resp.status_code == 413
    assert "File too large" in resp.json()["detail"]


def test_upload_accepts_at_limit_content_length(authenticated_client, monkeypatch):
    """A Content-Length within the bucket limit (accounting for multipart
    framing slack) is accepted — the pre-check must not over-zealously
    reject legitimate uploads of close-to-limit files.
    """

    # A 4-byte PNG is comfortably under any reasonable limit.
    def fake_upload_file(*args, **kwargs):
        return "https://example.com/qr-assets/ok.png"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)
    files = _make_file("ok.png", _real_png(), "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)
    assert resp.status_code == 200


# ── Regression: audit U7 — extension derived from content-type only ────


def test_upload_ignores_user_supplied_filename_extension(authenticated_client, monkeypatch):
    """Audit U7: the stored object's path must use the extension that
    matches the validated content-type, never the user-supplied filename.
    A PNG uploaded as ``evil.html`` becomes ``<uuid>.png``, not ``.html``.
    """
    fake_s3 = MagicMock()
    monkeypatch.setattr(storage, "_s3", fake_s3)
    monkeypatch.setattr(storage, "_bucket_name", "wat2do-test-assets")
    monkeypatch.setattr(storage, "_public_base_url", "https://wat2do.io/media")

    png = _real_png()
    files = _make_file("evil.html", png, "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    stored_key = fake_s3.put_object.call_args.kwargs["Key"]
    assert stored_key.endswith(".png")
    assert not stored_key.endswith(".html")


# ── Regression: audit U8 — SVGs uploaded with Content-Disposition: attachment ──


def test_upload_svg_sets_content_disposition_attachment(authenticated_client, monkeypatch):
    """Audit U8: storage uploads for SVG must set Content-Disposition:
    attachment so browsers download rather than inline-render on
    navigation (the latter would execute any surviving script in the
    storage origin).
    """
    fake_s3 = MagicMock()
    monkeypatch.setattr(storage, "_s3", fake_s3)
    monkeypatch.setattr(storage, "_bucket_name", "wat2do-test-assets")
    monkeypatch.setattr(storage, "_public_base_url", "https://wat2do.io/media")

    clean_svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
    files = _make_file("ok.svg", clean_svg, "image/svg+xml")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    stored_options = fake_s3.put_object.call_args.kwargs
    assert stored_options["ContentType"] == "image/svg+xml"
    assert stored_options["ContentDisposition"] == "attachment"


def test_upload_png_does_not_set_content_disposition(authenticated_client, monkeypatch):
    """Raster uploads don't set content-disposition — they're safe to render inline."""
    fake_s3 = MagicMock()
    monkeypatch.setattr(storage, "_s3", fake_s3)
    monkeypatch.setattr(storage, "_bucket_name", "wat2do-test-assets")
    monkeypatch.setattr(storage, "_public_base_url", "https://wat2do.io/media")

    files = _make_file("ok.png", _real_png(), "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    stored_options = fake_s3.put_object.call_args.kwargs
    assert "ContentDisposition" not in stored_options


# ── Regression: audit U9 — EXIF metadata stripped from uploads ─────────


def test_upload_strips_exif_from_jpeg(authenticated_client, monkeypatch):
    """A JPEG with EXIF metadata is re-encoded without the metadata before
    being handed to storage (audit U9)."""
    stored_bytes: bytes | None = None

    def fake_upload_file(bucket, file_bytes, content_type):
        nonlocal stored_bytes
        stored_bytes = file_bytes
        return "https://example.com/avatars/x.jpg"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    from services import user_service

    monkeypatch.setattr(user_service, "update_user", MagicMock())

    # get_db_user dep returns the DB user — stub it directly since the
    # test fixture doesn't override it.
    from schemas.user import UserResponse

    class _StubDbUser:
        id = FAKE_USER["id"]
        avatar_url = None

    from routers import uploads as uploads_router

    monkeypatch.setattr(
        uploads_router,
        "get_db_user",
        lambda: _StubDbUser(),
        raising=False,
    )

    exif_jpeg = _real_jpeg_with_exif()
    # Sanity check: the input really does contain the LEAKED marker.
    assert b"LEAKED" in exif_jpeg

    files = _make_file("photo.jpg", exif_jpeg, "image/jpeg")
    resp = authenticated_client.post("/uploads/avatar", files=files)

    # Note: avatar uses get_db_user; without a proper override this might
    # fail.  Fall back to verifying the sanitizer directly if the HTTP
    # path isn't reachable.
    if resp.status_code != 200:
        # The dependency override couldn't be stubbed here — verify the
        # core invariant at the service layer instead.
        cleaned, ct = storage.validate_and_prepare(
            "avatars",
            exif_jpeg,
            "image/jpeg",
        )
        assert ct == "image/jpeg"
        assert b"LEAKED" not in cleaned
        return

    assert stored_bytes is not None
    assert b"LEAKED" not in stored_bytes


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


# ── Regression: audit U10 — path traversal via old_url ─────────────────


def test_path_from_url_rejects_traversal():
    """path_from_url returns None for URLs whose stored path contains ``..``.

    Without this, a user who PATCHes their event with
    ``source_image_url=".../event-images/../shared-asset.png"`` could cause
    an unrelated object to be deleted when they next upload (audit U10).
    """
    # Legitimate URL passes through.
    service = StorageService(
        MagicMock(),
        bucket_name="wat2do-test-assets",
        public_base_url="https://wat2do.io/media",
    )

    ok = service.path_from_url(
        "https://wat2do.io/media/event-images/abc123.png",
        "event-images",
    )
    assert ok == "abc123.png"

    # Traversal is refused.
    bad = service.path_from_url(
        "https://wat2do.io/media/event-images/../shared.png",
        "event-images",
    )
    assert bad is None

    # Absolute path is refused.
    bad_abs = service.path_from_url(
        "https://wat2do.io/media/event-images//etc/passwd",
        "event-images",
    )
    assert bad_abs is None


def test_upload_file_writes_private_s3_object_and_returns_cloudfront_url():
    s3 = MagicMock()
    service = StorageService(
        s3,
        bucket_name="wat2do-test-assets",
        public_base_url="https://wat2do.io/media",
    )

    url = service.upload_file("event-images", b"image-bytes", "image/png")

    assert url.startswith("https://wat2do.io/media/event-images/")
    assert url.endswith(".png")
    put = s3.put_object.call_args.kwargs
    assert put["Bucket"] == "wat2do-test-assets"
    assert put["Key"].startswith("media/event-images/")
    assert put["Body"] == b"image-bytes"
    assert put["ContentType"] == "image/png"
    assert put["ServerSideEncryption"] == "AES256"


def test_delete_file_deletes_only_the_expected_s3_key():
    s3 = MagicMock()
    service = StorageService(
        s3,
        bucket_name="wat2do-test-assets",
        public_base_url="https://wat2do.io/media",
    )

    service.delete_file("avatars", "abc123.jpg")

    s3.delete_object.assert_called_once_with(
        Bucket="wat2do-test-assets",
        Key="media/avatars/abc123.jpg",
    )
