"""Database-backed school directory and identity lookups."""

from __future__ import annotations

import re
import unicodedata
from typing import Final

from core.database import get_sb
from core.tables import SCHOOLS
from schemas.school import School, SchoolSummary

DEFAULT_SEARCH_LIMIT: Final[int] = 10
SCHOOL_COLUMNS: Final[str] = (
    "slug, name, primary_color, secondary_color, timezone, "
    "recipient_id, semester_start, semester_end"
)


def _normalize(text: str | None) -> str:
    return " ".join(unicodedata.normalize("NFKC", text or "").casefold().split())


def _compact(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", _normalize(text))


def normalize_school_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def get_school(slug: str | None) -> School | None:
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
    return School.model_validate(response.data[0])


def get_school_by_recipient_id(recipient_id: str | None) -> School | None:
    normalized_recipient_id = (recipient_id or "").strip()
    if not normalized_recipient_id:
        return None
    response = (
        get_sb()
        .table(SCHOOLS)
        .select(SCHOOL_COLUMNS)
        .eq("recipient_id", normalized_recipient_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return School.model_validate(response.data[0])


def school_exists(slug: str | None) -> bool:
    return get_school(slug) is not None


def _score_term(term: str, query: str, query_compact: str) -> tuple[int, int] | None:
    term_compact = _compact(term)
    if not term_compact:
        return None

    if term == query or term_compact == query_compact:
        return (0, len(term_compact))
    if term.startswith(query) or term_compact.startswith(query_compact):
        return (1, len(term_compact))
    if query in term or query_compact in term_compact:
        return (2, len(term_compact))
    return None


def search_schools(query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list[SchoolSummary]:
    """Search the school directory using a fuzzy, prefix-friendly match."""
    normalized_query = _normalize(query)
    query_compact = _compact(normalized_query)
    response = (
        get_sb()
        .table(SCHOOLS)
        .select("slug, name, primary_color, secondary_color, school_email_domains(domain)")
        .order("name")
        .execute()
    )

    ranked: list[tuple[tuple[int, int, str], SchoolSummary]] = []
    for row in response.data or []:
        school = SchoolSummary.model_validate(row)
        if not normalized_query:
            ranked.append(((0, 0, school.name.casefold()), school))
            continue

        terms = {
            _normalize(school.slug),
            _compact(school.slug),
            _normalize(school.name),
            _compact(school.name),
        }
        for domain_row in row.get("school_email_domains") or []:
            domain = domain_row.get("domain")
            if domain:
                terms.add(_normalize(domain))
                terms.add(_compact(domain))
        best_rank: tuple[int, int, str] | None = None
        for term in terms:
            score = _score_term(term, normalized_query, query_compact)
            if score is None:
                continue
            candidate = (score[0], score[1], school.name.casefold())
            if best_rank is None or candidate < best_rank:
                best_rank = candidate
        if best_rank is not None:
            ranked.append((best_rank, school))

    ranked.sort(key=lambda item: item[0])
    return [school for _, school in ranked[:limit]]


def get_school_by_name(name: str | None) -> School | None:
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
    return School.model_validate(response.data[0])


__all__ = [
    "DEFAULT_SEARCH_LIMIT",
    "get_school",
    "get_school_by_recipient_id",
    "get_school_by_name",
    "normalize_school_slug",
    "school_exists",
    "search_schools",
]
