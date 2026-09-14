from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from core.exceptions import ValidationError
from services.school_context import (
    canonical_school_key,
    resolve_school_timezone,
)
from services.school_service import get_school

_INSTAGRAM_CAPTION_LIMIT = 2200


def default_caption_intro(school: str) -> str:
    school_slug = canonical_school_key(school)
    school_record = get_school(school_slug)
    if school_record is not None and school_record.language == "fr":
        return (
            f"Nouveaux événements à {school_slug}, ajoutés à Wat2Do dans les dernières 24 heures 👀"
        )
    return f"Fresh events at {school_slug}, added to Wat2Do in the last 24 hours 👀"


def build_caption(events: list[dict[str, Any]], school: str, intro: str = "") -> str:
    """Build a factual caption from canonical event data."""
    timezone = ZoneInfo(resolve_school_timezone(school))
    school_slug = canonical_school_key(school)
    school_hostname = f"{school_slug}.wat2do.io"
    school_record = get_school(school_slug)
    french = school_record is not None and school_record.language == "fr"
    lines = []
    for index, event in enumerate(events, start=1):
        start = _parse_datetime(event["dtstart_utc"]).astimezone(timezone)
        handle = str(event.get("ig_handle") or "").strip().lstrip("@")
        club = f"@{handle}" if handle else str(event.get("club") or "")
        title = _truncate(
            str(event.get("title") or ("Événement sans titre" if french else "Untitled event")), 90
        )
        location = _truncate(
            str(
                event.get("location")
                or ("Lieu sur Wat2Do" if french else "See Wat2Do for location")
            ),
            90,
        )
        hour_str = start.strftime("%I").lstrip("0")
        time_str = f"{hour_str}:{start.strftime('%M %p')}"
        date_str = f"{start.strftime('%a, %b')} {start.day}"
        if french:
            time_str = start.strftime("%H h %M")
            date_str = start.strftime("%d/%m/%Y")
        lines.extend(
            [
                f"{index}. {title}" + (f" - {club}" if club else ""),
                f"   🗓 {date_str} · {time_str}",
                f"   📍 {location}",
                "",
            ]
        )

    body = "\n".join(lines).rstrip()
    footer = "\n".join(
        [
            "À quel événement allez-vous participer ?" if french else "Which one are you going to?",
            "",
            (
                f"Dates, horaires, lieux, inscriptions et mises à jour sur {school_hostname}."
                if french
                else "For final, up-to-date dates, times, locations, registration details, "
                f"and event changes, visit {school_hostname}."
            ),
            "",
            f"#{school_slug.replace('-', '')} #CampusEvents #Wat2Do",
        ]
    )
    separator = "\n\n"
    prefix = f"{intro.strip()}{separator}" if intro.strip() else ""
    caption = f"{prefix}{body}{separator}{footer}"
    if len(caption) <= _INSTAGRAM_CAPTION_LIMIT:
        return caption

    body_limit = _INSTAGRAM_CAPTION_LIMIT - len(prefix) - len(separator) - len(footer) - 1
    if body_limit <= 0:
        raise ValidationError(
            "Caption intro and generated event details exceed Instagram's 2200-character limit. Shorten the intro or reduce the number of slides."
        )
    truncated_body = body[:body_limit].rstrip()
    return f"{prefix}{truncated_body}…{separator}{footer}"


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _truncate(value: str, length: int) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= length:
        return cleaned
    return f"{cleaned[: max(1, length - 1)].rstrip()}…"
