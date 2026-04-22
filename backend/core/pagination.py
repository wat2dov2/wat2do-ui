"""Reusable pagination utilities.

Provides:
- ``PaginationParams``: dependency-injectable dataclass for page/page_size
- ``PaginatedResponse``: generic response wrapper with pagination metadata
- ``paginated_response``: helper to build a PaginatedResponse dict
- ``fetch_all_pages``: exhaustive loader that pages through PostgREST's max-rows limit
- ``apply_stable_order``: attach a unique tiebreaker to a Supabase query order
"""

import logging
import math
from collections.abc import Callable, Generator
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

from core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_NUMBER, MAX_PAGE_SIZE

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal exhaustive pagination (PostgREST max-rows bypass)
# ---------------------------------------------------------------------------
# Supabase's default PostgREST max-rows is 1000 — queries without an explicit
# limit are silently truncated.  The helpers below page through the full result
# set so callers don't need to hand-roll the while-loop everywhere.

_LOAD_PAGE_SIZE = 1000

# Hard upper bound for ``fetch_all_pages`` / ``iter_all_pages`` (P17).  Without
# a cap, a bot user who bookmarks every event (or a runaway join) can force
# the helper to materialise an unbounded list in memory, crashing the process.
# 100k rows ≈ a few MB for typical payloads — generous enough for legitimate
# uses (saved-events, recommendation candidates) while catching anomalies.
_DEFAULT_MAX_ROWS = 100_000


class PaginationOverflowError(RuntimeError):
    """Raised when ``fetch_all_pages`` / ``iter_all_pages`` exceeds ``max_rows``.

    Defensive guard against pathological keyspaces (e.g. a bot that has
    bookmarked every event, a runaway join).  Callers that genuinely need
    more rows should opt in explicitly by passing a larger ``max_rows``.
    """


def fetch_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
    max_rows: int = _DEFAULT_MAX_ROWS,
) -> list[dict]:
    """Fetch all rows from a paginated PostgREST query.

    *query_fn(offset, page_size)* must execute one page of the query and
    return the resulting list of dicts (typically
    ``get_sb().table(T).select(...).range(offset, offset+page_size-1).execute().data or []``).

    Returns the concatenation of all pages.

    Raises :class:`PaginationOverflowError` if the total rows exceed
    *max_rows* (P17).  Callers expecting a legitimately large result
    should pass an explicit ``max_rows`` — the default cap is a safety
    net against pathological queries, not a performance tuning knob.
    """
    if max_rows <= 0:
        raise ValueError("max_rows must be positive")
    rows: list[dict] = []
    offset = 0
    while True:
        page = query_fn(offset, page_size)
        rows.extend(page)
        if len(page) < page_size:
            break
        if len(rows) >= max_rows:
            log.warning(
                "fetch_all_pages: exceeded max_rows=%d after %d offset=%d — "
                "refusing to load more rows; query may be misconfigured or "
                "caller should use paginated access",
                max_rows,
                len(rows),
                offset,
            )
            raise PaginationOverflowError(
                f"fetch_all_pages exceeded max_rows={max_rows}; "
                f"refusing to load more rows (offset={offset})"
            )
        offset += page_size
    return rows


def iter_all_pages(
    query_fn: Callable[[int, int], list[dict]],
    *,
    page_size: int = _LOAD_PAGE_SIZE,
    max_rows: int = _DEFAULT_MAX_ROWS,
) -> Generator[dict, None, None]:
    """Yield every row from a paginated PostgREST query.

    Same contract as :func:`fetch_all_pages` but yields rows one at a time,
    useful when the caller aggregates in-place (e.g. into a dict) and doesn't
    need the full list.

    Raises :class:`PaginationOverflowError` if the total rows exceed
    *max_rows* (P17).  The caller receives any rows yielded before the
    cap is breached.
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
                # Only raise if there is another page behind this one —
                # otherwise we'd flag completely-inlined result sets whose
                # size simply equals the cap.
                log.warning(
                    "iter_all_pages: exceeded max_rows=%d — refusing to "
                    "yield more rows (query may be misconfigured)",
                    max_rows,
                )
                raise PaginationOverflowError(
                    f"iter_all_pages exceeded max_rows={max_rows}"
                )
        if len(page) < page_size:
            break
        offset += page_size

T = TypeVar("T")


class PaginationParams:
    """FastAPI-injectable dependency that validates page & page_size query params."""

    def __init__(
        self,
        page: int = Query(default=1, ge=1, le=MAX_PAGE_NUMBER, description="Page number (1-indexed)"),
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
    """Attach a unique tiebreaker column to a Supabase/PostgREST ``order`` chain.

    Without a unique secondary sort key, offset pagination over data with
    ties (duplicate ``submitted_at``, identical ``dtstart_utc``) returns
    non-deterministic results — rows can be duplicated across pages or
    silently skipped when concurrent writes reshuffle the tie group (P6/P8).

    Usage::

        q = get_sb().table(T).select("*")
        q = apply_stable_order(q, "submitted_at")  # desc=True, tiebreaker="id"
        q = q.range(offset, offset + limit - 1)

    Returns the mutated query (PostgREST builders are chainable; the
    original object is still valid to use directly if preferred).
    """
    # PostgREST's python builder uses .order(column, desc=bool).  Some
    # older versions take positional bool; we stick to the keyword form
    # which is consistent with the supabase-py surface area.
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
