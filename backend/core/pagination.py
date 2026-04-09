"""Reusable pagination utilities for admin list endpoints.

Provides:
- ``PaginationParams``: dependency-injectable dataclass for page/page_size
- ``PaginatedResponse``: generic response wrapper with pagination metadata
- ``paginated_response``: helper to build a PaginatedResponse dict
"""

import math
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

from core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

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
