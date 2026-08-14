"""Database-backed school directory and identity lookups."""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Final

from core.database import get_sb
from core.tables import SCHOOLS
from schemas.school import SchoolRecord, SchoolSummary, validate_recipient_id

DEFAULT_SEARCH_LIMIT: Final[int] = 10
SCHOOL_COLUMNS: Final[str] = (
    "id, slug, name, primary_color, secondary_color, timezone, "
    "recipient_id, semester_start, semester_end, social_preview_image_url, "
    "social_preview_revision, social_preview_rendered_revision, social_preview_rendered_at"
)
SCHOOL_SLUG_EMBED: Final[str] = "school_record:schools(slug)"


def _normalize(text: str | None) -> str:
    return " ".join(unicodedata.normalize("NFKC", text or "").casefold().split())


def _compact(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", _normalize(text))


def normalize_school_slug(value: str | None) -> str:
    return (value or "").strip().lower()


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
    return SchoolRecord.model_validate(response.data[0])


@lru_cache(maxsize=128)
def get_school_by_recipient_id(recipient_id: str | None) -> SchoolRecord | None:
    normalized_recipient_id = (recipient_id or "").strip()
    if not normalized_recipient_id:
        return None
    try:
        normalized_recipient_id = validate_recipient_id(normalized_recipient_id)
    except ValueError:
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
    return SchoolRecord.model_validate(response.data[0])


def list_notification_routed_schools() -> list[SchoolRecord]:
    """Return every school that owns an Instagram notification recipient."""
    response = (
        get_sb()
        .table(SCHOOLS)
        .select(SCHOOL_COLUMNS)
        .not_.is_("recipient_id", "null")
        .order("slug")
        .execute()
    )
    return [SchoolRecord.model_validate(row) for row in response.data or []]


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


def _ordered_email_domains(domain_rows: list[dict] | None) -> list[str]:
    """School domains with the primary one first, then the rest alphabetically.

    Consumers read the head of this list as *the* domain for a school - the
    sign-in placeholder, for one - so a school that also accepts a subdomain
    must not lead with it. Alphabetical order alone puts "edu.uwaterloo.ca"
    ahead of "uwaterloo.ca", which is why the primary flag decides.
    """
    primary: list[str] = []
    secondary: set[str] = set()
    for domain_row in domain_rows or []:
        domain = str(domain_row.get("domain") or "").strip().lower()
        if not domain:
            continue
        if domain_row.get("is_primary"):
            primary.append(domain)
        else:
            secondary.add(domain)
    primary.sort()
    return [*primary, *sorted(secondary - set(primary))]


def search_schools(query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list[SchoolSummary]:
    """Search the school directory using a fuzzy, prefix-friendly match."""
    normalized_query = _normalize(query)
    query_compact = _compact(normalized_query)
    response = (
        get_sb()
        .table(SCHOOLS)
        .select(
            "slug, name, primary_color, secondary_color, school_email_domains(domain, is_primary)"
        )
        .order("name")
        .execute()
    )

    ranked: list[tuple[tuple[int, int, str], SchoolSummary]] = []
    for row in response.data or []:
        email_domains = _ordered_email_domains(row.get("school_email_domains"))
        school = SchoolSummary.model_validate(
            {
                **row,
                "email_domains": email_domains,
            }
        )
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
    return SchoolRecord.model_validate(response.data[0])


__all__ = [
    "DEFAULT_SEARCH_LIMIT",
    "get_school",
    "get_school_by_recipient_id",
    "get_school_by_name",
    "get_school_id",
    "list_notification_routed_schools",
    "normalize_school_slug",
    "SCHOOL_SLUG_EMBED",
    "school_exists",
    "search_schools",
    "with_school_slug",
]
