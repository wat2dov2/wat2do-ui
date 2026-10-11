"""Official school event directories and the clubs that publish them.

Sources live in ``public.directory_sources``. Directory agents
(``directory_agent``) read each source's listing; this module only describes
the sources.
"""

from __future__ import annotations

import functools
from urllib.parse import urlsplit

from core.database import get_sb
from core.tables import DIRECTORY_SOURCES
from schemas.directory_source import DirectorySource
from services import club_service, school_service


def list_sources() -> list[DirectorySource]:
    rows = (
        get_sb()
        .table(DIRECTORY_SOURCES)
        .select(f"*,{school_service.SCHOOL_SLUG_EMBED}")
        .order("id")
        .execute()
    ).data or []
    return [DirectorySource.model_validate(school_service.with_school_slug(row)) for row in rows]


@functools.lru_cache(maxsize=1)
def _sources_by_school() -> dict[str, tuple[DirectorySource, ...]]:
    grouped: dict[str, list[DirectorySource]] = {}
    for source in list_sources():
        grouped.setdefault(source.school, []).append(source)
    return {school: tuple(sources) for school, sources in grouped.items()}


def default_club_logo(school: str | None, source_url: str | None) -> str | None:
    """Logo of the directory's publishing club, shown when the host club has none."""
    sources = _sources_by_school().get(school or "")
    if not sources:
        return None
    host = _host(source_url)
    source = next((s for s in sources if _host(s.url) == host), sources[0])
    if not source.default_club_ig:
        return None
    club = club_service.lookup_club_by_school_and_ig(source.school, source.default_club_ig)
    return club.get("logo_url") if club else None


def _host(url: str | None) -> str:
    return (urlsplit(url or "").hostname or "").removeprefix("www.")
