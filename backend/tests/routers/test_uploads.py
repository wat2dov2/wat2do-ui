from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from schemas.event import EventResponse
from schemas.club import ClubResponse
from services.storage_service import storage
from services import event_service, club_service
from tests.conftest import FAKE_USER, OTHER_USER


def _make_file(filename: str, content: bytes, content_type: str) -> dict:
    # FastAPI TestClient expects a tuple of (filename, fileobj/bytes, content_type)
    return {"file": (filename, content, content_type)}


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


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 1,
        "club_name": "Test Club",
        "club_type": "WUSA",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


# ── QR asset uploads (no resource ownership — just auth) ────────────────


def test_upload_qr_asset_success(authenticated_client, monkeypatch):
    """QR asset upload succeeds with valid image and auth, returning URL."""

    recorded: dict | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:  # type: ignore[override]
        nonlocal recorded
        recorded = {
            "bucket": bucket,
            "file_bytes": file_bytes,
            "filename": filename,
            "content_type": content_type,
        }
        return "https://example.com/qr-assets/fake.png"

    monkeypatch.setattr(storage, "upload_file", fake_upload_file)

    files = _make_file("poster.png", b"fake-bytes", "image/png")
    resp = authenticated_client.post("/uploads/qr-asset", files=files)

    assert resp.status_code == 200
    data = resp.json()
    assert data["url"] == "https://example.com/qr-assets/fake.png"

    assert recorded is not None
    assert recorded["bucket"] == "qr-assets"
    assert recorded["file_bytes"] == b"fake-bytes"
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

    files = _make_file("poster.png", b"fake-bytes", "image/png")
    resp = client.post("/uploads/qr-asset", files=files)

    assert resp.status_code in (401, 403)


def test_upload_svg_sanitizes_script_tags(authenticated_client, monkeypatch):
    """SVG uploads are sanitized — <script> tags are stripped before storage."""

    stored_bytes: bytes | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
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
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    files = _make_file("poster.png", b"fake-bytes", "image/png")
    resp = other_user_client.post("/uploads/event-image/1", files=files)
    assert resp.status_code == 403


def test_upload_event_image_owner_allowed(authenticated_client, monkeypatch):
    """Owner can upload an image to their own event."""
    event = _mock_event(created_by=FAKE_USER["id"])
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(event_service, "update_event", MagicMock(return_value=event))
    monkeypatch.setattr(storage, "upload_file", MagicMock(return_value="https://example.com/img.png"))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    files = _make_file("poster.png", b"fake-bytes", "image/png")
    resp = authenticated_client.post("/uploads/event-image/1", files=files)
    assert resp.status_code == 200


# ── Club logo upload ownership ──────────────────────────────────────────


def test_upload_club_logo_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot upload a logo to someone else's club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    files = _make_file("logo.png", b"fake-bytes", "image/png")
    resp = other_user_client.post("/uploads/club-logo/1", files=files)
    assert resp.status_code == 403


def test_upload_club_logo_owner_allowed(authenticated_client, monkeypatch):
    """Owner can upload a logo to their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "update_club", MagicMock(return_value=club))
    monkeypatch.setattr(storage, "upload_file", MagicMock(return_value="https://example.com/logo.png"))

    from services import user_service
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    files = _make_file("logo.png", b"fake-bytes", "image/png")
    resp = authenticated_client.post("/uploads/club-logo/1", files=files)
    assert resp.status_code == 200


# ── Content-Type spoofing: SVG disguised as other image types ──────────


def test_svg_disguised_as_png_still_sanitized(authenticated_client, monkeypatch):
    """SVG content uploaded as image/png is detected and sanitized, not passed through raw."""

    stored_bytes: bytes | None = None

    def fake_upload_file(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
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

    def fake_upload_file(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
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
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    malicious_svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg">'
        b"<script>alert('xss')</script>"
        b"</svg>"
    )
    # event-images bucket does NOT allow image/svg+xml
    files = _make_file("evil.png", malicious_svg, "image/png")
    resp = authenticated_client.post("/uploads/event-image/1", files=files)

    assert resp.status_code == 400
    assert "SVG" in resp.json()["detail"]
