"""School directory helpers backed by the allowed-email dataset."""

from __future__ import annotations

import re
import unicodedata
from typing import Final

from core.allowed_emails import ALLOWED_EMAIL_DOMAINS

DEFAULT_SEARCH_LIMIT: Final[int] = 10


def _normalize(text: str | None) -> str:
    return " ".join(unicodedata.normalize("NFKC", text or "").casefold().split())


def _compact(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", _normalize(text))


def _canonical_school_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for school in ALLOWED_EMAIL_DOMAINS.values():
        normalized = _normalize(school)
        if normalized:
            lookup.setdefault(normalized, school.strip())
    return lookup


def list_schools() -> list[str]:
    """Return the canonical school names the backend knows about."""
    lookup = _canonical_school_lookup()
    ordered_keys = sorted(lookup, key=lambda key: lookup[key].casefold())
    return [lookup[key] for key in ordered_keys]


def _search_index() -> dict[str, tuple[str, ...]]:
    lookup = _canonical_school_lookup()
    index: dict[str, set[str]] = {
        school: {_normalize(school), _compact(school)}
        for school in lookup.values()
    }

    for domain, school in ALLOWED_EMAIL_DOMAINS.items():
        canonical = lookup.get(_normalize(school))
        if canonical:
            index[canonical].add(_normalize(domain))
            index[canonical].add(_compact(domain))

    return {
        school: tuple(sorted(term for term in terms if term))
        for school, terms in index.items()
    }


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


def search_schools(query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list[str]:
    """Search the allowed-school directory using a fuzzy, prefix-friendly match."""
    normalized_query = _normalize(query)
    if not normalized_query:
        return []

    query_compact = _compact(normalized_query)
    if not query_compact:
        return []

    ranked: list[tuple[tuple[int, int, str], str]] = []
    for school, terms in _search_index().items():
        best_rank: tuple[int, int, str] | None = None
        for term in terms:
            score = _score_term(term, normalized_query, query_compact)
            if score is None:
                continue
            candidate = (score[0], score[1], school.casefold())
            if best_rank is None or candidate < best_rank:
                best_rank = candidate
        if best_rank is not None:
            ranked.append((best_rank, school))

    ranked.sort(key=lambda item: item[0])
    return [school for _, school in ranked[:limit]]


__all__ = ["DEFAULT_SEARCH_LIMIT", "list_schools", "search_schools"]
