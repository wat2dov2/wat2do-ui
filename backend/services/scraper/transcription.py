"""Transcribe one retrieved Instagram video's speech without ingestion writes."""

from openai import OpenAI, OpenAIError

from core.config import settings
from core.controlbox import controlbox
from services.scraper.image_uploader import MediaDownloadError, download_video


class ReelTranscriptionError(RuntimeError):
    """An actionable transcription failure safe to print in a local command."""


def require_transcription_key() -> None:
    """Fail before a paid scrape when transcription is not configured."""
    if not settings.openai_api_key:
        raise ReelTranscriptionError("Set OPENAI_API_KEY in backend/.env before transcribing.")


def transcribe_post(post: dict) -> dict[str, str]:
    """Keep the spoken transcript distinct from the author's post caption."""
    require_transcription_key()
    config = controlbox.reel_transcription
    try:
        media = download_video(
            post.get("videoUrl"),
            maximum_bytes=config.maximum_media_bytes,
            timeout_seconds=config.download_timeout_seconds,
        )
    except MediaDownloadError as exc:
        raise ReelTranscriptionError(str(exc)) from None
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
