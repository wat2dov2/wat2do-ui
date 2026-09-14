"""Shared API pagination envelopes, stable query ordering, and exhaustive loaders."""

import logging
import math
from collections.abc import Callable, Generator
from datetime import datetime
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

from core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_NUMBER, MAX_PAGE_SIZE

log = logging.getLogger(__name__)

# Explicit pages avoid PostgREST's default max-rows truncation.
_LOAD_PAGE_SIZE = 1000

# Bound exhaustive reads to prevent runaway queries from exhausting memory.
_DEFAULT_MAX_ROWS = 100_000


class PaginationOverflowError(RuntimeError):
    """An exhaustive read reached its configured row cap on a full page."""


def fetch_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
    max_rows: int = _DEFAULT_MAX_ROWS,
) -> list[dict]:
    """Collect the shared paginated iterator into a list."""
    return list(iter_all_pages(query_fn, page_size=page_size, max_rows=max_rows))


def iter_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
    max_rows: int = _DEFAULT_MAX_ROWS,
) -> Generator[dict, None, None]:
    """Yield rows until a partial page, refusing full pages beyond the row cap.

    query_fn(offset, page_size) executes one page and returns its rows.
    Callers may consume rows before PaginationOverflowError is raised.
    """
    if max_rows <= 0:
        raise ValueError("max_rows must be positive")
    offset = 0
    yielded = 0
    while True:
        page = query_fn(offset, page_size)
        for row in page:
            yield row
            yielded += 1
            if yielded >= max_rows and len(page) == page_size:
                # A full page may hide more rows; do not return an incomplete result.
                log.warning(
                    "iter_all_pages: exceeded max_rows=%d - refusing to "
                    "yield more rows (query may be misconfigured)",
                    max_rows,
                )
                raise PaginationOverflowError(f"iter_all_pages exceeded max_rows={max_rows}")
        if len(page) < page_size:
            break
        offset += page_size


T = TypeVar("T")


class LatestAddedItem(BaseModel):
    title: str
    added_at: datetime


class PaginationParams:
    """FastAPI-injectable dependency that validates page & page_size query params."""

    def __init__(
        self,
        page: int = Query(
            default=1, ge=1, le=MAX_PAGE_NUMBER, description="Page number (1-indexed)"
        ),
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


def apply_stable_order(
    query: Any,
    primary: str,
    *,
    desc: bool = True,
    tiebreaker: str = "id",
) -> Any:
    """Add a unique tiebreaker so offset pages cannot drift when primary values tie."""
    return query.order(primary, desc=desc).order(tiebreaker, desc=desc)


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
