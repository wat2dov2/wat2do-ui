"""Extraction ``Completion`` backed by a headless, unsaved Claude Code session."""

from __future__ import annotations

import logging
import mimetypes
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx

from core.controlbox import controlbox

log = logging.getLogger(__name__)
CONTROL = controlbox.ingestion


def claude_completion(system: str, prompt: str, image_urls: list[str]) -> str | None:
    """Answer one extraction prompt; images are viewed from a throwaway directory."""
    executable = shutil.which("claude")
    if executable is None:
        log.warning("Claude Code is not installed")
        return None
    with tempfile.TemporaryDirectory(prefix="wat2do-ingestion-") as workdir:
        markers = []
        for index, url in enumerate(image_urls[: CONTROL.max_images_per_item]):
            name = _download_image(url, Path(workdir), index)
            markers.append(f"Image {index}: ./{name}" if name else f"Image {index}: unavailable")
        text = "\n\n".join(
            [
                prompt,
                *(
                    [
                        "Read every available image file below with the Read tool before answering.",
                        "\n".join(markers),
                    ]
                    if markers
                    else []
                ),
                "Respond with the JSON only.",
            ]
        )
        try:
            result = subprocess.run(
                [
                    executable,
                    "-p",
                    "--model",
                    CONTROL.model,
                    "--system-prompt",
                    system,
                    "--tools",
                    "Read",
                    "--permission-mode",
                    "dontAsk",
                    "--strict-mcp-config",
                    "--no-session-persistence",
                    "--output-format",
                    "text",
                ],
                input=text,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=CONTROL.model_timeout_seconds,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("Claude extraction call failed (%s)", type(exc).__name__)
            return None
    if result.returncode:
        log.warning("Claude extraction call failed (exit %s)", result.returncode)
        return None
    return result.stdout


def _download_image(url: str, directory: Path, index: int) -> str | None:
    try:
        response = httpx.get(url, timeout=CONTROL.fetch_timeout_seconds, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError:
        return None
    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    if not content_type.startswith("image/"):
        return None
    name = f"image-{index}{mimetypes.guess_extension(content_type) or '.jpg'}"
    (directory / name).write_bytes(response.content)
    return name
