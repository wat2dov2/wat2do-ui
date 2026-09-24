from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime

from core.constants import MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH
from core.errors import POSITION_NOT_FOUND
from core.exceptions import get_or_404
from core.pagination import PaginationParams, paginated_response
from schemas.position import PositionDirectoryResponse, PositionResponse, PositionType
from services import position_service

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("/", response_model=PositionDirectoryResponse)
def list_positions(
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    position_type: PositionType | None = Query(default=None),
    club_id: int | None = Query(default=None, ge=1),
    include_closed: bool = Query(default=False),
    added_since: AwareDatetime | None = Query(default=None),
    paid_only: bool = Query(default=False),
    sort_order: Literal["asc", "desc"] = Query(default="asc"),
    pagination: PaginationParams = Depends(),
):
    items, total = position_service.list_positions(
        skip=pagination.offset,
        limit=pagination.page_size,
        school=school,
        search=search,
        position_type=position_type,
        club_id=club_id,
        include_closed=include_closed,
        added_since=added_since,
        paid_only=paid_only,
        sort_order=sort_order,
    )
    return {
        **paginated_response(items, total, pagination),
        "latest_added_position": position_service.get_latest_added_position(school),
    }


@router.get("/{position_id}", response_model=PositionResponse)
def get_position(position_id: int):
    return get_or_404(position_service.get_position(position_id), POSITION_NOT_FOUND)
