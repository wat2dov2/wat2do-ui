import logging

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_optional_user, resolve_db_user
from core.constants import (
    MAX_STATUS_FILTER_LENGTH,
    REPORT_RATE_LIMIT_MAX_REQUESTS,
    REPORT_RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import REPORT_NOT_FOUND
from core.exceptions import get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import RateLimiter
from schemas.report import ReportCreate, ReportResponse, ReportUpdate
from schemas.user import UserResponse
from services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])
log = logging.getLogger(__name__)


# The client IP rate limit complements the event-exists check in
# report_service.create_report. Together they close the "fill the reports
# table with forged event IDs" attack while allowing anonymous reports.
_report_create_limiter = RateLimiter(
    max_requests=REPORT_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=REPORT_RATE_LIMIT_WINDOW_SECONDS,
)


@router.post("/", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(
    data: ReportCreate,
    auth_user: dict | None = Depends(get_optional_user),
    _rl: None = Depends(_report_create_limiter.dependency()),
):
    user: UserResponse | None = resolve_db_user(auth_user) if auth_user else None
    return report_service.create_report(
        str(user.id) if user else None,
        data.event_id,
        data.reason,
    )


@router.get("/", response_model=PaginatedResponse[ReportResponse])
def list_reports(
    report_status: str | None = Query(default=None, max_length=MAX_STATUS_FILTER_LENGTH),
    pagination: PaginationParams = Depends(),
    _: dict = Depends(get_admin_user),
):
    items, total = report_service.get_reports(
        status=report_status,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.patch("/{report_id}", response_model=ReportResponse)
def update_report(
    report_id: str,
    data: ReportUpdate,
    _: dict = Depends(get_admin_user),
):
    return get_or_404(report_service.update_report(report_id, data.status), REPORT_NOT_FOUND)
