"""Public position-directory reads."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from core.constants import DEFAULT_LIST_LIMIT
from core.database import get_sb
from core.pagination import LatestAddedItem
from core.sanitize import sanitize_postgrest_value
from core.tables import POSITIONS
from schemas.position import PositionResponse, PositionType
from services import school_service

_POSITION_COMPUTED_FIELDS = {
    "club_name",
    "club_logo_url",
    "club_type",
    "club_page",
    "club_ig",
    "club_discord",
    "school",
}
_POSITION_COLUMNS = ",".join(
    field for field in PositionResponse.model_fields if field not in _POSITION_COMPUTED_FIELDS
)
_POSITION_SELECT = (
    f"{_POSITION_COLUMNS},clubs(club_name,logo_url,club_type,club_page,ig,discord),"
    f"{school_service.SCHOOL_SLUG_EMBED}"
)


def _apply_open_filter(query: Any) -> Any:
    today = date.today().isoformat()
    return query.eq("is_active", True).or_(f"deadline_date.is.null,deadline_date.gte.{today}")


def _position_response(row: dict) -> PositionResponse:
    normalized = school_service.with_school_slug(row)
    club = normalized.pop("clubs", None)
    club_fields = (
        {
            "club_name": club.get("club_name"),
            "club_logo_url": club.get("logo_url"),
            "club_type": club.get("club_type"),
            "club_page": club.get("club_page"),
            "club_ig": club.get("ig"),
            "club_discord": club.get("discord"),
        }
        if isinstance(club, dict)
        else {}
    )
    return PositionResponse.model_validate({**normalized, **club_fields})


def list_positions(
    *,
    skip: int = 0,
    limit: int = DEFAULT_LIST_LIMIT,
    school: str | None = None,
    search: str | None = None,
    position_type: PositionType | None = None,
    club_id: int | None = None,
    include_closed: bool = False,
    added_since: datetime | None = None,
    paid_only: bool = False,
    sort_order: str = "asc",
) -> tuple[list[PositionResponse], int]:
    query = get_sb().table(POSITIONS).select(_POSITION_SELECT, count="exact")

    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if position_type is not None:
        query = query.eq("position_type", position_type)
    if added_since is not None:
        query = query.gte("added_at", added_since.isoformat())
    if paid_only:
        query = query.eq("is_paid", True)
    if club_id is not None:
        query = query.eq("club_id", club_id)
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
        query.order("deadline_date", desc=sort_order == "desc", nullsfirst=False)
        .order("deadline_at", desc=sort_order == "desc", nullsfirst=False)
        .order("id", desc=sort_order == "desc")
        .range(skip, skip + limit - 1)
        .execute()
    )
    items = [_position_response(row) for row in response.data or []]
    return items, response.count or len(items)


def get_club_position_counts(
    club_ids: list[int],
) -> dict[int, int]:
    """Return per-club open-position totals."""
    if not club_ids:
        return {}

    counts = {club_id: 0 for club_id in club_ids}
    response = _apply_open_filter(
        get_sb().table(POSITIONS).select("club_id").in_("club_id", club_ids)
    ).execute()

    for row in response.data or []:
        club_id = row.get("club_id")
        if club_id in counts:
            counts[club_id] += 1

    return counts


def get_latest_added_position(school: str | None) -> LatestAddedItem | None:
    query = _apply_open_filter(get_sb().table(POSITIONS).select("title,added_at"))
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return None
        query = query.eq("school_id", school_id)
    response = query.order("added_at", desc=True).order("id", desc=True).limit(1).execute()
    return LatestAddedItem.model_validate(response.data[0]) if response.data else None


def get_position(position_id: int) -> PositionResponse | None:
    response = (
        get_sb().table(POSITIONS).select(_POSITION_SELECT).eq("id", position_id).limit(1).execute()
    )
    if not response.data:
        return None
    return _position_response(response.data[0])
