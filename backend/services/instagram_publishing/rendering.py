from __future__ import annotations

import math
import textwrap
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from PIL import Image, ImageDraw, ImageFont, ImageOps

from core.config import settings
from core.constants import BUCKET_EVENT_IMAGES
from services.school_context import resolve_school_timezone, school_display_name
from services.storage_service import storage

_WIDTH = 1080
_HEIGHT = 1350
_BLUE = "#2B7FFF"
_INK = "#071120"
_SURFACE = "#F7F9FC"
_MUTED = "#5B6678"
_MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024
_FONT_DIRS = (
    Path("/usr/share/fonts/truetype/dejavu"),
    Path("/System/Library/Fonts/Supplemental"),
)


def render_event_asset(event: dict[str, Any]) -> str:
    """Render and upload one immutable Instagram carousel slide."""
    canvas = Image.new("RGB", (_WIDTH, _HEIGHT), _SURFACE)
    source = _download_image(event["source_image_url"])
    poster = ImageOps.fit(source.convert("RGB"), (_WIDTH, 710), method=Image.Resampling.LANCZOS)
    canvas.paste(poster, (0, 0))

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 700, _WIDTH, _HEIGHT), fill=_SURFACE)
    draw.rectangle((0, 700, 18, _HEIGHT), fill=_BLUE)

    label = str(event.get("category") or "CAMPUS EVENT").upper()
    draw.rounded_rectangle((70, 752, 70 + min(540, 26 + len(label) * 19), 808), 18, fill=_BLUE)
    draw.text((88, 764), label, font=_font(28, bold=True), fill="white")

    title_lines = _wrap(str(event.get("title") or "Untitled event"), 27, max_lines=3)
    draw.multiline_text(
        (70, 842),
        "\n".join(title_lines),
        font=_font(54, bold=True),
        fill=_INK,
        spacing=8,
    )

    start = _parse_datetime(event["dtstart_utc"])
    local_tz = ZoneInfo(resolve_school_timezone(event.get("school")))
    start_local = start.astimezone(local_tz)
    time_line = start_local.strftime("%A, %B %-d at %-I:%M %p")
    location = str(event.get("location") or "See Wat2Do for location")
    organization = str(event.get("organization") or "Campus organization")
    handle = str(event.get("ig_handle") or "").strip().lstrip("@")
    organization_line = f"@{handle}" if handle else organization

    details_y = 1072
    draw.text((70, details_y), time_line, font=_font(34, bold=True), fill=_INK)
    draw.text((70, details_y + 55), _truncate(location, 52), font=_font(32), fill=_MUTED)
    draw.text((70, details_y + 108), _truncate(organization_line, 48), font=_font(30), fill=_MUTED)
    draw.text((70, 1285), "wat2do.io", font=_font(30, bold=True), fill=_BLUE)

    return _upload_png(canvas)


def render_cover_asset(events: list[dict[str, Any]], school: str) -> str:
    """Render an equal-tile collage cover and upload it."""
    if not events:
        raise ValueError("at least one event is required to render a cover")

    canvas = Image.new("RGB", (_WIDTH, _HEIGHT), _BLUE)
    columns = min(3, max(1, math.ceil(math.sqrt(len(events)))))
    rows = math.ceil(len(events) / columns)
    tile_width = math.ceil(_WIDTH / columns)
    tile_height = math.ceil(_HEIGHT / rows)

    for index, event in enumerate(events):
        row, column = divmod(index, columns)
        image = _download_image(event["source_image_url"])
        tile = ImageOps.fit(
            image.convert("RGB"),
            (tile_width, tile_height),
            method=Image.Resampling.LANCZOS,
        )
        canvas.paste(tile, (column * tile_width, row * tile_height))

    overlay = Image.new("RGBA", (_WIDTH, _HEIGHT), (7, 17, 32, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rectangle((0, 0, _WIDTH, _HEIGHT), fill=(7, 17, 32, 75))
    overlay_draw.rounded_rectangle(
        (54, 820, _WIDTH - 54, _HEIGHT - 68),
        34,
        fill=(7, 17, 32, 225),
        outline=_BLUE,
        width=6,
    )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(canvas)

    school_name = school_display_name(school).upper()
    draw.text((100, 875), "NEW EVENTS AT", font=_font(48, bold=True), fill=_BLUE)
    school_lines = _wrap(school_name, 24, max_lines=2)
    draw.multiline_text(
        (100, 946),
        "\n".join(school_lines),
        font=_font(69, bold=True),
        fill="white",
        spacing=4,
    )
    draw.text(
        (100, 1160),
        "Added to Wat2Do in the last 24 hours",
        font=_font(31),
        fill="#D7E5FF",
    )
    draw.text((100, 1220), "wat2do.io", font=_font(34, bold=True), fill="white")
    return _upload_png(canvas.convert("RGB"))


def _download_image(url: str) -> Image.Image:
    parsed = urlparse(url)
    allowed = urlparse(settings.supabase_url)
    if parsed.scheme != "https" or parsed.hostname != allowed.hostname:
        raise ValueError("Instagram publishing source images must use Supabase Storage")

    payload = bytearray()
    with httpx.stream("GET", url, timeout=20, follow_redirects=False) as response:
        response.raise_for_status()
        if not (response.headers.get("content-type") or "").lower().startswith("image/"):
            raise ValueError("Instagram publishing source URL did not return an image")
        for chunk in response.iter_bytes():
            payload.extend(chunk)
            if len(payload) > _MAX_SOURCE_IMAGE_BYTES:
                raise ValueError("Instagram publishing source image is too large")

    image = Image.open(BytesIO(payload))
    image.load()
    return image


def _upload_png(image: Image.Image) -> str:
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return storage.upload_file(BUCKET_EVENT_IMAGES, output.getvalue(), "image/png")


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        ("DejaVuSans-Bold.ttf", "Arial Bold.ttf")
        if bold
        else (
            "DejaVuSans.ttf",
            "Arial.ttf",
        )
    )
    for directory in _FONT_DIRS:
        for name in names:
            path = directory / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _wrap(value: str, width: int, *, max_lines: int) -> list[str]:
    lines = textwrap.wrap(" ".join(value.split()), width=width) or [value]
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = _truncate(lines[-1], max(2, width - 1))
    return lines


def _truncate(value: str, length: int) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= length:
        return cleaned
    return f"{cleaned[: max(1, length - 1)].rstrip()}…"


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
