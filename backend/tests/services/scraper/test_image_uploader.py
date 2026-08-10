"""Unit tests for services/scraper/image_uploader.

Focus on the SSRF allowlist (``_is_safe_image_url``). The download +
upload path is intentionally not exercised here - that wires through
real httpx + S3 storage and is covered by the pipeline integration
test instead.
"""

from unittest.mock import MagicMock, patch

from core.constants import BUCKET_EVENT_IMAGES
from services.scraper import image_uploader
from services.scraper.image_uploader import _is_safe_image_url


# Patch socket.getaddrinfo to a public-IP response so we test the
# allowlist + scheme logic without depending on real DNS or network.
def _mock_addrinfo(host, port):
    # Return a single (family, type, proto, canonname, sockaddr) tuple
    # whose IP is a public address (157.240.0.1 == Facebook).
    return [(2, 1, 6, "", ("157.240.0.1", 0))]


def _mock_addrinfo_private(host, port):
    return [(2, 1, 6, "", ("169.254.169.254", 0))]


def test_https_instagram_cdn_allowed():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert _is_safe_image_url("https://scontent-iad-1.cdninstagram.com/v/t51/abc.jpg")
        assert _is_safe_image_url("https://scontent.fora1-1.fna.fbcdn.net/v/t51/x.jpg")


def test_http_rejected():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert not _is_safe_image_url("http://scontent-iad-1.cdninstagram.com/v/t51/abc.jpg")


def test_non_instagram_host_rejected():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert not _is_safe_image_url("https://attacker.example/payload.jpg")
        assert not _is_safe_image_url("https://google.com/img.jpg")


def test_allow_all_domains():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert _is_safe_image_url("https://wusa.ca/img.jpg", allow_all_domains=True)
        assert not _is_safe_image_url("https://wusa.ca/img.jpg", allow_all_domains=False)


def test_metadata_service_rejected_even_if_host_allowlisted(monkeypatch):
    """DNS-rebind style: an allowlisted hostname resolves to a metadata IP."""
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo_private):
        assert not _is_safe_image_url("https://scontent-iad-1.cdninstagram.com/v/t51/abc.jpg")


def test_loopback_ip_rejected():
    def _loop(host, port):
        return [(2, 1, 6, "", ("127.0.0.1", 0))]

    with patch("services.scraper.image_uploader.socket.getaddrinfo", _loop):
        assert not _is_safe_image_url("https://scontent-iad-1.cdninstagram.com/v/abc.jpg")


def test_private_ip_rejected():
    def _priv(host, port):
        return [(2, 1, 6, "", ("10.0.0.5", 0))]

    with patch("services.scraper.image_uploader.socket.getaddrinfo", _priv):
        assert not _is_safe_image_url("https://scontent.fora1-1.fna.fbcdn.net/v/x.jpg")


def test_unresolvable_host_rejected():
    import socket

    def _gai(host, port):
        raise socket.gaierror("name or service not known")

    with patch("services.scraper.image_uploader.socket.getaddrinfo", _gai):
        assert not _is_safe_image_url("https://scontent-iad-1.cdninstagram.com/v/abc.jpg")


def test_other_schemes_rejected():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert not _is_safe_image_url("file:///etc/passwd")
        assert not _is_safe_image_url("ftp://scontent.fbcdn.net/x.jpg")
        assert not _is_safe_image_url("data:image/png;base64,iVBOR...")


def test_garbage_url_rejected():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert not _is_safe_image_url("not-a-url")
        assert not _is_safe_image_url("")


def test_upload_returns_none_for_unsafe_url():
    """End-to-end: ``upload_image_from_url`` short-circuits for unsafe URLs."""
    # No need to mock httpx - _is_safe_image_url returns False before fetch.
    assert (
        image_uploader.upload_image_from_url(
            "https://attacker.example/x.jpg",
            bucket=BUCKET_EVENT_IMAGES,
        )
        is None
    )
    assert (
        image_uploader.upload_image_from_url(
            "http://localhost:8000/admin",
            bucket=BUCKET_EVENT_IMAGES,
        )
        is None
    )


def test_upload_validates_bytes_for_requested_bucket(monkeypatch):
    response = MagicMock()
    response.headers = {"content-type": "image/jpeg"}
    response.content = b"raw-image"
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    monkeypatch.setattr(image_uploader.httpx, "Client", lambda **kwargs: client)
    monkeypatch.setattr(image_uploader, "_is_safe_image_url", lambda *args, **kwargs: True)

    validate = MagicMock(return_value=(b"clean-image", "image/jpeg"))
    upload = MagicMock(return_value="https://wat2do.io/media/organization-logos/logo.jpg")
    monkeypatch.setattr(image_uploader.storage, "validate_and_prepare", validate)
    monkeypatch.setattr(image_uploader.storage, "upload_file", upload)

    result = image_uploader.upload_image_from_url(
        "https://scontent.cdninstagram.com/logo.jpg",
        bucket="organization-logos",
    )

    assert result == "https://wat2do.io/media/organization-logos/logo.jpg"
    validate.assert_called_once_with("organization-logos", b"raw-image", "image/jpeg")
    upload.assert_called_once_with(
        "organization-logos",
        b"clean-image",
        content_type="image/jpeg",
    )
