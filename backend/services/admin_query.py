"""Bounded ID selection for cross-school administration lists."""

from typing import Literal

from core.database import get_sb
from core.tables import ADMIN_LIST_ENTRIES

AdminResource = Literal["events", "reports", "submissions", "claims", "clubSubmissions"]


def load_page_ids(
    resource: AdminResource,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    school: str | None = None,
    status: str | None = None,
    category: str | None = None,
) -> tuple[list[str], int]:
    query = get_sb().table(ADMIN_LIST_ENTRIES).select("id", count="exact").eq("resource", resource)
    if search and search.strip():
        # This is a separate filter value, not an interpolated .or_ expression.
        query = query.ilike("search_text", f"%{search.strip()}%")
    for name, value in (("school", school), ("status", status), ("category", category)):
        if value:
            query = query.eq(name, value)
    response = (
        query.order("sort_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    )
    return [row["id"] for row in response.data or []], int(response.count or 0)


def load_page_rows(
    resource: AdminResource,
    table: str,
    columns: str,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    school: str | None = None,
    status: str | None = None,
) -> tuple[list[dict], int]:
    ids, total = load_page_ids(
        resource, offset=offset, limit=limit, search=search, school=school, status=status
    )
    if not ids:
        return [], total
    result = get_sb().table(table).select(columns).in_("id", ids).execute()
    by_id = {str(row["id"]): row for row in result.data or []}
    return [by_id[id] for id in ids if id in by_id], total
