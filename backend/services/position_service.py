"""Public position-directory reads."""

from __future__ import annotations

from datetime import date
from typing import Any

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.sanitize import sanitize_postgrest_value
from core.tables import POSITIONS
from schemas.position import PositionResponse, PositionType
from services import school_service

_POSITION_SELECT = (
    "*,organizations(organization_name,logo_url,organization_type,organization_page,ig,discord),"
    f"{school_service.SCHOOL_SLUG_EMBED}"
)


def _apply_open_filter(query: Any) -> Any:
    today = date.today().isoformat()
    return query.eq("is_active", True).or_(f"deadline_date.is.null,deadline_date.gte.{today}")


def _position_response(row: dict) -> PositionResponse:
    normalized = school_service.with_school_slug(row)
    organization = normalized.pop("organizations", None)
    organization_fields = (
        {
            "organization_name": organization.get("organization_name"),
            "organization_logo_url": organization.get("logo_url"),
            "organization_type": organization.get("organization_type"),
            "organization_page": organization.get("organization_page"),
            "organization_ig": organization.get("ig"),
            "organization_discord": organization.get("discord"),
        }
        if isinstance(organization, dict)
        else {}
    )
    return PositionResponse.model_validate({**normalized, **organization_fields})


def list_positions(
    *,
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    school: str | None = None,
    search: str | None = None,
    position_type: PositionType | None = None,
    organization_id: int | None = None,
    include_closed: bool = False,
) -> tuple[list[PositionResponse], int]:
    query = get_sb().table(POSITIONS).select(_POSITION_SELECT, count="exact")

    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if position_type is not None:
        query = query.eq("position_type", position_type)
    if organization_id is not None:
        query = query.eq("organization_id", organization_id)
    if search:
        term = sanitize_postgrest_value(search)
        if term:
            quoted = f'"%{term}%"'
            query = query.or_(
                ",".join(
                    (
                        f"title.ilike.{quoted}",
                        f"description.ilike.{quoted}",
                        f"commitment.ilike.{quoted}",
                        f"location.ilike.{quoted}",
                    )
                )
            )
    if not include_closed:
        query = _apply_open_filter(query)

    response = (
        query.order("deadline_date", desc=False, nullsfirst=False)
        .order("deadline_at", desc=False, nullsfirst=False)
        .order("id", desc=False)
        .range(skip, skip + limit - 1)
        .execute()
    )
    items = [_position_response(row) for row in response.data or []]
    return items, response.count or len(items)


def get_organization_position_counts(
    organization_ids: list[int],
) -> dict[int, int]:
    """Return per-organization open-position totals."""
    if not organization_ids:
        return {}

    counts = {organization_id: 0 for organization_id in organization_ids}
    response = _apply_open_filter(
        get_sb().table(POSITIONS).select("organization_id").in_("organization_id", organization_ids)
    ).execute()

    for row in response.data or []:
        organization_id = row.get("organization_id")
        if organization_id in counts:
            counts[organization_id] += 1

    return counts


def get_position(position_id: int) -> PositionResponse | None:
    response = (
        get_sb().table(POSITIONS).select(_POSITION_SELECT).eq("id", position_id).limit(1).execute()
    )
    if not response.data:
        return None
    return _position_response(response.data[0])
