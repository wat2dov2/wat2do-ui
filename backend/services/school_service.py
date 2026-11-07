"""Database-backed school directory and identity lookups."""

from __future__ import annotations

from functools import lru_cache
from typing import Final

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import SCHOOLS
from schemas.school import CampusSeasonWindow, SchoolEventSeason, SchoolRecord

SCHOOL_COLUMNS: Final[str] = (
    "id, slug, name, city, primary_color, secondary_color, timezone, language, faculties, location_examples, "
    "recipient_id, semester_start, semester_end"
)
SCHOOL_SLUG_EMBED: Final[str] = "school_record:schools(slug)"


def normalize_school_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def campus_season_ids(school: str) -> frozenset[str]:
    configured = controlbox.event_discovery.campus_seasons.schools.get(
        normalize_school_slug(school)
    )
    return frozenset(season.id for season in configured.seasons) if configured else frozenset()


def _event_seasons(slug: str) -> list[SchoolEventSeason]:
    """Project static school configuration without exposing prompt instructions."""
    configuration = controlbox.event_discovery.campus_seasons
    school = configuration.schools.get(normalize_school_slug(slug))
    if school is None:
        return []
    result: list[SchoolEventSeason] = []
    for season in school.seasons:
        # Named windows share the event classification, but each exposes only its
        # own dates and label as a selectable discovery filter.
        filter_ids = list(
            dict.fromkeys(window.filter_id or season.id for window in season.display_windows)
        )
        if not filter_ids:
            filter_ids = [season.id]
        for filter_id in filter_ids:
            result.append(
                SchoolEventSeason(
                    id=filter_id,
                    classification_id=season.id,
                    labels=configuration.definitions[filter_id].labels,
                    display_windows=[
                        CampusSeasonWindow(start_date=window.start_date, end_date=window.end_date)
                        for window in season.display_windows
                        if (window.filter_id or season.id) == filter_id
                    ],
                )
            )
    return result


def _school_record(row: dict) -> SchoolRecord:
    return SchoolRecord.model_validate({**row, "event_seasons": _event_seasons(row["slug"])})


@lru_cache(maxsize=128)
def get_school(slug: str | None) -> SchoolRecord | None:
    normalized_slug = normalize_school_slug(slug)
    if not normalized_slug:
        return None
    response = (
        get_sb()
        .table(SCHOOLS)
        .select(SCHOOL_COLUMNS)
        .eq("slug", normalized_slug)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return _school_record(response.data[0])


@lru_cache(maxsize=128)
def get_school_by_id(school_id: int | None) -> SchoolRecord | None:
    if not school_id:
        return None
    response = get_sb().table(SCHOOLS).select(SCHOOL_COLUMNS).eq("id", school_id).limit(1).execute()
    if not response.data:
        return None
    return _school_record(response.data[0])


def get_school_id(slug_or_name: str | None) -> int | None:
    school = get_school(slug_or_name) or get_school_by_name(slug_or_name)
    return school.id if school is not None else None


def with_school_slug(row: dict, *, relation: str = "school_record") -> dict:
    """Flatten an embedded schools row into the public ``school`` slug."""
    normalized = dict(row)
    if relation not in normalized:
        return normalized
    school_record = normalized.pop(relation, None)
    normalized["school"] = (
        str(school_record["slug"])
        if isinstance(school_record, dict) and school_record.get("slug")
        else None
    )
    return normalized


@lru_cache(maxsize=128)
def get_school_by_name(name: str | None) -> SchoolRecord | None:
    normalized_name = (name or "").strip()
    if not normalized_name:
        return None
    response = (
        get_sb()
        .table(SCHOOLS)
        .select(SCHOOL_COLUMNS)
        .ilike("name", normalized_name)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return _school_record(response.data[0])


__all__ = [
    "campus_season_ids",
    "get_school",
    "get_school_by_name",
    "get_school_id",
    "normalize_school_slug",
    "SCHOOL_SLUG_EMBED",
    "with_school_slug",
]
