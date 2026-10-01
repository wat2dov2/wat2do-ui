"""Directory identity shared by scraping, media repair and event presentation."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlsplit

from pydantic import BaseModel, Field


class DirectoryConfig(BaseModel):
    """Configuration schema for a directory scraper target."""

    id: str
    name: str
    school: str
    default_club: str
    default_club_ig: str | None = None
    source_format: Literal["html", "ical", "json"]
    entry_url: str
    event_url_patterns: list[str]
    event_url_exclude_patterns: list[str] = Field(default_factory=list)
    json_url_fields: list[str] = Field(default_factory=lambda: ["url"])
    next_page_selector: str | None = None
    content_selector: str | None = None
    image_selector: str | None = None


def matches_event_url(url: str, config: DirectoryConfig) -> bool:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if any(pattern in url for pattern in config.event_url_exclude_patterns):
            return False
        for pattern in config.event_url_patterns:
            target = urlsplit(
                urljoin(config.entry_url, pattern)
                if pattern.startswith("/")
                else f"https://{pattern}"
            )
            if (
                parsed.hostname.removeprefix("www.") == (target.hostname or "").removeprefix("www.")
                and target.path in parsed.path
            ):
                return True
        return False
    except ValueError:
        return False


@lru_cache(maxsize=1)
def directory_configs() -> tuple[DirectoryConfig, ...]:
    rows = json.loads((Path(__file__).parent / "urls" / "directories.json").read_text())
    return tuple(DirectoryConfig.model_validate(row) for row in rows)


def directory_for_event(source_url: str | None, school: str | None) -> DirectoryConfig | None:
    if not source_url or not school:
        return None
    return next(
        (
            config
            for config in directory_configs()
            if config.school == school and matches_event_url(source_url, config)
        ),
        None,
    )
