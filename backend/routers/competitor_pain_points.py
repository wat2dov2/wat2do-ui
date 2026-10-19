from uuid import UUID

from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user
from core.constants import MAX_SEARCH_QUERY_LENGTH
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.competitor_pain_point import (
    CompetitorPainPointResponse,
    CompetitorPainPointReview,
    PainPointAudience,
    PainPointStatus,
)
from schemas.user import UserResponse
from services.competitor_pain_points import service

router = APIRouter(prefix="/competitor-pain-points", tags=["competitor-pain-points"])


@router.get("/", response_model=PaginatedResponse[CompetitorPainPointResponse])
def list_pain_points(
    competitor: str | None = Query(default=None, pattern=r"^[a-z0-9_]+$", max_length=64),
    source: str | None = Query(default=None, pattern=r"^[a-z0-9_]+$", max_length=64),
    audience: PainPointAudience | None = Query(default=None),
    pain_point_status: PainPointStatus | None = Query(default=None),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = service.list_pain_points(
        competitor=competitor,
        source=source,
        audience=audience,
        status=pain_point_status,
        search=search,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.patch("/{pain_point_id}", response_model=CompetitorPainPointResponse)
def review_pain_point(
    pain_point_id: UUID,
    data: CompetitorPainPointReview,
    _: UserResponse = Depends(get_admin_user),
):
    return service.review_pain_point(str(pain_point_id), data.status)
