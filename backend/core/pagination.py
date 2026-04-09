"""Reusable pagination utilities.

Provides:
- ``PaginationParams``: dependency-injectable dataclass for page/page_size
- ``PaginatedResponse``: generic response wrapper with pagination metadata
- ``paginated_response``: helper to build a PaginatedResponse dict
- ``fetch_all_pages``: exhaustive loader that pages through PostgREST's max-rows limit
"""

import math
from collections.abc import Callable, Generator
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

from core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

# ---------------------------------------------------------------------------
# Internal exhaustive pagination (PostgREST max-rows bypass)
# ---------------------------------------------------------------------------
# Supabase's default PostgREST max-rows is 1000 — queries without an explicit
# limit are silently truncated.  The helpers below page through the full result
# set so callers don't need to hand-roll the while-loop everywhere.

_LOAD_PAGE_SIZE = 1000


def fetch_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
) -> list[dict]:
    """Fetch all rows from a paginated PostgREST query.

    *query_fn(offset, page_size)* must execute one page of the query and
    return the resulting list of dicts (typically
    ``get_sb().table(T).select(...).range(offset, offset+page_size-1).execute().data or []``).

    Returns the concatenation of all pages.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        page = query_fn(offset, page_size)
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def iter_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
) -> Generator[dict, None, None]:
    """Yield every row from a paginated PostgREST query.

    Same contract as :func:`fetch_all_pages` but yields rows one at a time,
    useful when the caller aggregates in-place (e.g. into a dict) and doesn't
    need the full list.
    """
    offset = 0
    while True:
        page = query_fn(offset, page_size)
        yield from page
        if len(page) < page_size:
            break
        offset += page_size

T = TypeVar("T")


class PaginationParams:
    """FastAPI-injectable dependency that validates page & page_size query params."""

    def __init__(
        self,
        page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
        page_size: int = Query(
            default=DEFAULT_PAGE_SIZE,
            ge=1,
            le=MAX_PAGE_SIZE,
            description=f"Items per page (max {MAX_PAGE_SIZE})",
        ),
    ):
        self.page = page
        self.page_size = page_size

    @property
    def offset(self) -> int:
        """Zero-based offset for Supabase .range()."""
        return (self.page - 1) * self.page_size


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response envelope."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


def paginated_response(
    items: list[T],
    total: int,
    params: PaginationParams,
) -> dict:
    """Build a PaginatedResponse dict from items, total count, and params."""
    return {
        "items": items,
        "total": total,
        "page": params.page,
        "page_size": params.page_size,
        "total_pages": math.ceil(total / params.page_size) if total > 0 else 0,
    }
