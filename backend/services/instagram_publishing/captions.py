from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from services.school_context import (
    canonical_school_key,
    resolve_school_timezone,
)

_INSTAGRAM_CAPTION_LIMIT = 2200


def build_caption(events: list[dict[str, Any]], school: str) -> str:
    """Build a factual caption from canonical event data."""
    timezone = ZoneInfo(resolve_school_timezone(school))
    school_slug = canonical_school_key(school)
    school_hostname = f"{school_slug}.wat2do.io"
    lines = [
        f"Fresh events at {school_slug}, added to Wat2Do in the last 24 hours 👀",
        "",
    ]
    for index, event in enumerate(events, start=1):
        start = _parse_datetime(event["dtstart_utc"]).astimezone(timezone)
        handle = str(event.get("ig_handle") or "").strip().lstrip("@")
        organization = f"@{handle}" if handle else str(event.get("organization") or "")
        title = _truncate(str(event.get("title") or "Untitled event"), 90)
        location = _truncate(str(event.get("location") or "See Wat2Do for location"), 90)
        hour_str = start.strftime("%I").lstrip("0")
        time_str = f"{hour_str}:{start.strftime('%M %p')}"
        date_str = f"{start.strftime('%a, %b')} {start.day}"
        lines.extend(
            [
                f"{index}. {title}" + (f" - {organization}" if organization else ""),
                f"   🗓 {date_str} · {time_str}",
                f"   📍 {location}",
                "",
            ]
        )

    body = "\n".join(lines).rstrip()
    footer = "\n".join(
        [
            "Which one are you going to?",
            "",
            (
                "For final, up-to-date dates, times, locations, registration details, "
                f"and event changes, visit {school_hostname}."
            ),
            "",
            f"#{school_slug.replace('-', '')} #CampusEvents #Wat2Do",
        ]
    )
    separator = "\n\n"
    caption = f"{body}{separator}{footer}"
    if len(caption) <= _INSTAGRAM_CAPTION_LIMIT:
        return caption

    body_limit = _INSTAGRAM_CAPTION_LIMIT - len(separator) - len(footer) - 1
    truncated_body = body[:body_limit].rstrip()
    return f"{truncated_body}…{separator}{footer}"


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _truncate(value: str, length: int) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= length:
        return cleaned
    return f"{cleaned[: max(1, length - 1)].rstrip()}…"
