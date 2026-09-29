from unittest.mock import MagicMock

import httpx
import pytest
from openai import APIConnectionError

from core.config import settings
from services.scraper import image_uploader, transcription

URL = "https://www.instagram.com/reel/DdyqycEINNe/"
VIDEO = "https://scontent.cdninstagram.com/video.mp4"


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    response = MagicMock()
    response.headers = {"content-type": "video/mp4"}
    response.iter_bytes.return_value = [b"video", b"-data"]
    stream = MagicMock()
    stream.return_value.__enter__.return_value = response
    monkeypatch.setattr(image_uploader.httpx, "stream", stream)
    monkeypatch.setattr(
        image_uploader.socket, "getaddrinfo", lambda *_: [(2, 1, 6, "", ("157.240.0.1", 0))]
    )
    factory = MagicMock()
    client = factory.return_value.__enter__.return_value
    client.audio.transcriptions.create.return_value.text = " Spoken words. "
    monkeypatch.setattr(transcription, "OpenAI", factory)
    return response, stream, client


def test_transcription_uploads_video_and_keeps_caption_separate(providers):
    response, stream, client = providers
    assert transcription.transcribe_post(
        {"url": URL, "videoUrl": VIDEO, "caption": "Written caption"}
    ) == {"url": URL, "caption": "Written caption", "transcript": "Spoken words."}
    assert client.audio.transcriptions.create.call_args.kwargs["file"] == (
        "reel.mp4",
        b"video-data",
        "video/mp4",
    )
    assert stream.call_args.kwargs["follow_redirects"] is False


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "http://scontent.cdninstagram.com/v",
        "https://localhost/v",
        "https://cdninstagram.com.evil.test/v",
    ],
)
def test_rejects_missing_or_untrusted_video_before_download(providers, url):
    _, stream, client = providers
    with pytest.raises(transcription.ReelTranscriptionError):
        transcription.transcribe_post({"url": URL, "videoUrl": url})
    stream.assert_not_called()
    client.audio.transcriptions.create.assert_not_called()


@pytest.mark.parametrize("chunks", [[], [b"x" * 24_000_001]])
def test_rejects_empty_and_oversized_media_before_transcription(providers, chunks):
    response, _, client = providers
    response.iter_bytes.return_value = chunks
    with pytest.raises(transcription.ReelTranscriptionError):
        transcription.transcribe_post({"url": URL, "videoUrl": VIDEO})
    client.audio.transcriptions.create.assert_not_called()


def test_rejects_html_response(providers):
    response, _, client = providers
    response.headers = {"content-type": "text/html"}
    with pytest.raises(transcription.ReelTranscriptionError, match="MP4"):
        transcription.transcribe_post({"url": URL, "videoUrl": VIDEO})
    client.audio.transcriptions.create.assert_not_called()


def test_missing_key_fails_before_download(providers, monkeypatch):
    _, stream, _ = providers
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(transcription.ReelTranscriptionError, match="OPENAI_API_KEY"):
        transcription.transcribe_post({"url": URL, "videoUrl": VIDEO})
    stream.assert_not_called()


def test_provider_error_does_not_expose_request_details(providers):
    _, _, client = providers
    client.audio.transcriptions.create.side_effect = APIConnectionError(
        request=httpx.Request("POST", "https://example.test/private")
    )
    with pytest.raises(transcription.ReelTranscriptionError, match="Transcription failed") as error:
        transcription.transcribe_post({"url": URL, "videoUrl": VIDEO})
    assert "private" not in str(error.value)


def test_download_error_is_actionable(providers):
    response, _, client = providers
    response.raise_for_status.side_effect = httpx.HTTPError("signed private URL")
    with pytest.raises(transcription.ReelTranscriptionError, match="fresh Instagram video link"):
        transcription.transcribe_post({"url": URL, "videoUrl": VIDEO})
    client.audio.transcriptions.create.assert_not_called()
