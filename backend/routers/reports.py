import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import get_current_user, get_admin_user, resolve_db_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.report import ReportCreate, ReportUpdate, ReportResponse
from core.errors import REPORT_NOT_FOUND
from services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])
log = logging.getLogger(__name__)


@router.post("/", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(data: ReportCreate, auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    return report_service.create_report(str(user.id), data.event_id, data.reason)


@router.get("/", response_model=PaginatedResponse[ReportResponse])
def list_reports(
    report_status: str | None = None,
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
    row = report_service.update_report(report_id, data.status)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=REPORT_NOT_FOUND)
    return row
