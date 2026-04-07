import io

import pytest

from services.storage_service import storage


def _make_file(filename: str, content: bytes, content_type: str) -> dict:
    # FastAPI TestClient expects a tuple of (filename, fileobj/bytes, content_type)
    return {"file": (filename, content, content_type)}


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

