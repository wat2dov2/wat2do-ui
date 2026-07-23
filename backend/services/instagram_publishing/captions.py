from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from services.school_context import resolve_school_timezone, school_display_name


def build_caption(events: list[dict[str, Any]], school: str) -> str:
    """Build a factual caption from canonical event data."""
    timezone = ZoneInfo(resolve_school_timezone(school))
    lines = [
        f"Fresh events at {school_display_name(school)}, added to Wat2Do in the last 24 hours 👀",
        "",
    ]
    for index, event in enumerate(events, start=1):
        start = _parse_datetime(event["dtstart_utc"]).astimezone(timezone)
        handle = str(event.get("ig_handle") or "").strip().lstrip("@")
        organization = f"@{handle}" if handle else str(event.get("organization") or "")
        title = _truncate(str(event.get("title") or "Untitled event"), 90)
        location = _truncate(str(event.get("location") or "See Wat2Do for location"), 90)
        lines.extend(
            [
                f"{index}. {title}" + (f" - {organization}" if organization else ""),
                f"   🗓 {start.strftime('%a, %b %-d')} · {start.strftime('%-I:%M %p')}",
                f"   📍 {location}",
                "",
            ]
        )

    lines.extend(
        [
            "Which one are you going to?",
            "",
            (
                "For final, up-to-date dates, times, locations, registration details, "
                "and event changes, visit wat2do.io."
            ),
            "",
            f"#{school.replace('-', '')} #CampusEvents #Wat2Do",
        ]
    )
    caption = "\n".join(lines)
    if len(caption) <= 2200:
        return caption
    return f"{caption[:2199].rstrip()}…"


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _truncate(value: str, length: int) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= length:
        return cleaned
    return f"{cleaned[: max(1, length - 1)].rstrip()}…"
