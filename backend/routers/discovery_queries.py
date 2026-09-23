from fastapi import APIRouter, Depends, Query, Response, status

from core.auth import get_admin_user
from core.constants import MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH
from core.controlbox import controlbox
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import RateLimiter
from schemas.discovery_query import DiscoveryQueryCreate, DiscoveryQueryResponse
from schemas.user import UserResponse
from services import discovery_query_service

router = APIRouter(prefix="/discovery-queries", tags=["discovery-queries"])
_limiter = RateLimiter(
    max_requests=controlbox.discovery_queries.rate_limit.maximum_requests,
    window_seconds=controlbox.discovery_queries.rate_limit.window_seconds,
)


@router.post("/", status_code=status.HTTP_204_NO_CONTENT)
def record_query(
    data: DiscoveryQueryCreate,
    _rl: None = Depends(_limiter.ip_dependency()),
) -> Response:
    """Persist anonymous or signed-in browsing telemetry sent separately from UI reads.

    Acknowledge only after persistence so the background client can safely retry.
    """
    discovery_query_service.record_query(data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/", response_model=PaginatedResponse[DiscoveryQueryResponse])
def list_queries(
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = discovery_query_service.list_queries(
        offset=pagination.offset, limit=pagination.page_size, school=school, search=search
    )
    return paginated_response(items, total, pagination)
