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


def test_video_download_bounds_stream_and_does_not_follow_redirects(monkeypatch):
    import pytest

    response = MagicMock()
    response.headers = {"content-type": "video/mp4"}
    response.iter_bytes.return_value = [b"1234", b"5678"]
    stream = MagicMock()
    stream.return_value.__enter__.return_value = response
    monkeypatch.setattr(image_uploader.httpx, "stream", stream)
    monkeypatch.setattr(image_uploader.socket, "getaddrinfo", _mock_addrinfo)
    url = "https://scontent.cdninstagram.com/video.mp4"
    with pytest.raises(image_uploader.MediaDownloadError, match="media limit"):
        image_uploader.download_video(url, maximum_bytes=6, timeout_seconds=10)
    assert stream.call_args.kwargs["follow_redirects"] is False


def test_failed_video_upload_is_optional_and_does_not_expose_signed_url(monkeypatch, caplog):
    monkeypatch.setattr(
        image_uploader, "download_video", MagicMock(side_effect=RuntimeError("secret-url"))
    )
    assert (
        image_uploader.upload_video_from_url("https://scontent.cdninstagram.com/video?secret")
        is None
    )
    assert "secret" not in caplog.text


def test_video_rejects_nonpublic_addresses_and_embedded_credentials():
    import pytest

    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo_private):
        for url in [
            "https://scontent.cdninstagram.com/video.mp4",
            "https://user@scontent.cdninstagram.com/video.mp4",
            "https://scontent.cdninstagram.com:8443/video.mp4",
        ]:
            with pytest.raises(image_uploader.MediaDownloadError, match="unsupported video host"):
                image_uploader.download_video(url, maximum_bytes=100, timeout_seconds=10)


def test_directory_spinner_bytes_are_rejected_before_storage(monkeypatch):
    from io import BytesIO

    from PIL import Image

    data = BytesIO()
    Image.new("RGB", (40, 40)).save(data, format="GIF")
    response = MagicMock()
    response.content = data.getvalue()
    response.headers = {"content-type": "image/gif"}
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    monkeypatch.setattr(image_uploader.httpx, "Client", lambda **kwargs: client)
    monkeypatch.setattr(image_uploader, "_is_safe_image_url", lambda *args, **kwargs: True)
    upload = MagicMock()
    monkeypatch.setattr(image_uploader.storage, "upload_file", upload)
    assert (
        image_uploader.upload_image_from_url(
            "https://example.edu/opaque.gif", bucket=BUCKET_EVENT_IMAGES, allow_all_domains=True
        )
        is None
    )
    upload.assert_not_called()


def test_oversized_instagram_poster_is_resized_before_stored_size_validation(monkeypatch):
    from io import BytesIO

    from PIL import Image

    from services.storage_service import StorageService

    image = BytesIO()
    Image.new("RGB", (2160, 1080), "red").save(image, format="JPEG")
    response = MagicMock()
    response.headers = {"content-type": "image/jpeg"}
    response.content = image.getvalue()
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    monkeypatch.setattr(image_uploader.httpx, "Client", lambda **kwargs: client)
    monkeypatch.setattr(image_uploader, "_is_safe_image_url", lambda *args, **kwargs: True)
    storage = StorageService(
        MagicMock(), bucket_name="test", public_base_url="https://wat2do.io/media"
    )
    monkeypatch.setattr(image_uploader, "storage", storage)
    monkeypatch.setattr(storage, "get_file_size_limit", lambda *_: 15000)
    upload = MagicMock(return_value="https://wat2do.io/media/event-images/new.jpg")
    monkeypatch.setattr(storage, "upload_file", upload)

    assert len(response.content) > 15000
    assert image_uploader.upload_image_from_url(
        "https://scontent.cdninstagram.com/poster.jpg", bucket=BUCKET_EVENT_IMAGES
    )
    with Image.open(BytesIO(upload.call_args.args[1])) as stored:
        assert stored.size == (1080, 540)
    assert len(upload.call_args.args[1]) < 15000


def test_directory_image_redirects_validate_each_destination_before_download(monkeypatch):
    from io import BytesIO

    import httpx
    from PIL import Image

    artwork = BytesIO()
    Image.new("RGB", (400, 500), "red").save(artwork, format="JPEG")
    visited = []

    def respond(request):
        visited.append(str(request.url))
        if request.url.host == "wusa.ca":
            return httpx.Response(302, headers={"location": "https://assets.example:443/event.jpg"})
        return httpx.Response(
            200, content=artwork.getvalue(), headers={"content-type": "image/jpeg"}
        )

    client_class = httpx.Client
    monkeypatch.setattr(
        image_uploader.httpx,
        "Client",
        lambda **kwargs: client_class(transport=httpx.MockTransport(respond), **kwargs),
    )
    monkeypatch.setattr(image_uploader.socket, "getaddrinfo", _mock_addrinfo)
    upload = MagicMock(return_value="https://wat2do.io/media/event-images/event.jpg")
    monkeypatch.setattr(image_uploader.storage, "upload_file", upload)
    assert image_uploader.upload_image_from_url(
        "https://wusa.ca/poster", bucket=BUCKET_EVENT_IMAGES, allow_all_domains=True
    )
    assert visited == ["https://wusa.ca/poster", "https://assets.example/event.jpg"]
    upload.assert_called_once()


def test_image_redirect_to_private_network_is_never_requested(monkeypatch):
    import httpx

    visited = []

    def respond(request):
        visited.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://internal.example/secret"})

    client_class = httpx.Client
    monkeypatch.setattr(
        image_uploader.httpx,
        "Client",
        lambda **kwargs: client_class(transport=httpx.MockTransport(respond), **kwargs),
    )
    monkeypatch.setattr(
        image_uploader.socket,
        "getaddrinfo",
        lambda host, port: (
            _mock_addrinfo_private(host, port)
            if host == "internal.example"
            else _mock_addrinfo(host, port)
        ),
    )
    assert (
        image_uploader.upload_image_from_url(
            "https://wusa.ca/poster", bucket=BUCKET_EVENT_IMAGES, allow_all_domains=True
        )
        is None
    )
    assert visited == ["https://wusa.ca/poster"]


def test_instagram_redirect_cannot_escape_host_allowlist_and_cycles_are_bounded(monkeypatch):
    import httpx

    client_class = httpx.Client
    monkeypatch.setattr(image_uploader.socket, "getaddrinfo", _mock_addrinfo)
    for destination, expected_requests in [
        ("https://outside.example/art.jpg", 1),
        ("https://scontent.cdninstagram.com/cycle", 3),
    ]:
        visited = []

        def respond(request):
            visited.append(str(request.url))
            return httpx.Response(302, headers={"location": destination})

        monkeypatch.setattr(
            image_uploader.httpx,
            "Client",
            lambda **kwargs: client_class(
                transport=httpx.MockTransport(respond), max_redirects=2, **kwargs
            ),
        )
        assert (
            image_uploader.upload_image_from_url(
                "https://scontent.cdninstagram.com/poster", bucket=BUCKET_EVENT_IMAGES
            )
            is None
        )
        assert len(visited) == expected_requests


def test_image_urls_allow_explicit_standard_https_port_only():
    with patch("services.scraper.image_uploader.socket.getaddrinfo", _mock_addrinfo):
        assert _is_safe_image_url("https://scontent.cdninstagram.com:443/poster.jpg")
        assert not _is_safe_image_url("https://scontent.cdninstagram.com:444/poster.jpg")
