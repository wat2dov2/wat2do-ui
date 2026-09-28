"""Transcribe one retrieved Instagram video's speech without ingestion writes."""

from urllib.parse import urlsplit

import httpx
from openai import OpenAI, OpenAIError

from core.config import settings
from core.controlbox import controlbox


class ReelTranscriptionError(RuntimeError):
    """An actionable transcription failure safe to print in a local command."""


def require_transcription_key() -> None:
    """Fail before a paid scrape when transcription is not configured."""
    if not settings.openai_api_key:
        raise ReelTranscriptionError("Set OPENAI_API_KEY in backend/.env before transcribing.")


def transcribe_post(post: dict) -> dict[str, str]:
    """Keep the spoken transcript distinct from the author's post caption."""
    require_transcription_key()
    media = _download_video(post.get("videoUrl"))
    config = controlbox.reel_transcription
    try:
        with OpenAI(
            api_key=settings.openai_api_key,
            timeout=config.transcription_timeout_seconds,
            max_retries=0,
        ) as client:
            result = client.audio.transcriptions.create(
                model=config.model,
                file=("reel.mp4", media, "video/mp4"),
                response_format="json",
            )
    except OpenAIError:
        raise ReelTranscriptionError(
            "Transcription failed. Check OpenAI access/quota and that the video contains audio."
        ) from None
    return {
        "url": post["url"],
        "caption": post.get("caption") or "",
        "transcript": result.text.strip(),
    }


def _download_video(url: object) -> bytes:
    if not isinstance(url, str) or not url:
        raise ReelTranscriptionError("Instagram did not return a downloadable video for this post.")
    try:
        parsed = urlsplit(url)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname is not None
            and parsed.hostname.endswith((".cdninstagram.com", ".fbcdn.net"))
            and parsed.port is None
            and parsed.username is None
            and parsed.password is None
        )
    except ValueError:
        valid = False
    if not valid:
        raise ReelTranscriptionError("Instagram returned an unsupported video host.")

    config = controlbox.reel_transcription
    payload = bytearray()
    try:
        with httpx.stream(
            "GET", url, timeout=config.download_timeout_seconds, follow_redirects=False
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if content_type not in {"video/mp4", "application/octet-stream"}:
                raise ReelTranscriptionError("Instagram did not return an MP4 video.")
            for chunk in response.iter_bytes():
                if len(payload) + len(chunk) > config.maximum_media_bytes:
                    raise ReelTranscriptionError(
                        f"Video exceeds the {config.maximum_media_bytes:,}-byte transcription limit; "
                        "use a shorter/smaller video."
                    )
                payload.extend(chunk)
    except httpx.HTTPError:
        raise ReelTranscriptionError(
            "Video download failed. Retry the command to obtain a fresh Instagram video link."
        ) from None
    if not payload:
        raise ReelTranscriptionError("Instagram returned an empty video.")
    return bytes(payload)
