"""Append-only discovery queries, independent of the listing read paths."""

from core.database import get_sb
from core.errors import DISCOVERY_QUERY_SCHOOL_NOT_FOUND
from core.exceptions import ValidationError
from core.pagination import apply_stable_order
from core.sanitize import sanitize_postgrest_value
from core.tables import DISCOVERY_QUERIES
from schemas.discovery_query import DiscoveryQueryCreate, DiscoveryQueryResponse
from services import school_service


def record_query(data: DiscoveryQueryCreate) -> None:
    school = school_service.get_school(data.school)
    if school is None:
        raise ValidationError(DISCOVERY_QUERY_SCHOOL_NOT_FOUND)
    row = data.model_dump(mode="json", exclude={"school"})
    row["school_id"] = school.id
    # The client keeps this UUID on retries. Ignore duplicates without allowing
    # public callers to overwrite an existing record.
    get_sb().table(DISCOVERY_QUERIES).upsert(
        row, on_conflict="id", ignore_duplicates=True
    ).execute()


def list_queries(
    *, offset: int, limit: int, school: str | None, search: str | None
) -> tuple[list[DiscoveryQueryResponse], int]:
    query = (
        get_sb()
        .table(DISCOVERY_QUERIES)
        .select(
            f"id,surface,search_query,page_url,filters,created_at,{school_service.SCHOOL_SLUG_EMBED}",
            count="exact",
        )
    )
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            query = query.ilike("search_query", f"%{term}%")
    response = apply_stable_order(query, "created_at").range(offset, offset + limit - 1).execute()
    return [
        DiscoveryQueryResponse.model_validate(school_service.with_school_slug(row))
        for row in response.data or []
    ], response.count or 0
