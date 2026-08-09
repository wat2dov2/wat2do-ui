from fastapi import APIRouter, Depends, Query

from core.constants import MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH
from core.errors import POSITION_NOT_FOUND
from core.exceptions import get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.position import PositionResponse, PositionType
from services import position_service

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("/", response_model=PaginatedResponse[PositionResponse])
def list_positions(
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    position_type: PositionType | None = Query(default=None),
    organization_id: int | None = Query(default=None, ge=1),
    include_closed: bool = Query(default=False),
    pagination: PaginationParams = Depends(),
):
    items, total = position_service.list_positions(
        skip=pagination.offset,
        limit=pagination.page_size,
        school=school,
        search=search,
        position_type=position_type,
        organization_id=organization_id,
        include_closed=include_closed,
    )
    return paginated_response(items, total, pagination)


@router.get("/{position_id}", response_model=PositionResponse)
def get_position(position_id: int):
    return get_or_404(position_service.get_position(position_id), POSITION_NOT_FOUND)
