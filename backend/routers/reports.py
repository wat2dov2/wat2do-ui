import logging

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user, get_admin_user, resolve_db_user
from schemas.report import ReportCreate, ReportUpdate, ReportResponse
from core.errors import REPORT_NOT_FOUND
from services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])
log = logging.getLogger(__name__)


@router.post("/", response_model=ReportResponse, status_code=201)
def create_report(data: ReportCreate, auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    return report_service.create_report(str(user.id), data.event_id, data.reason)


@router.get("/", response_model=list[ReportResponse])
def list_reports(
    report_status: str | None = None,
    _: dict = Depends(get_admin_user),
):
    return report_service.get_reports(status=report_status)


@router.patch("/{report_id}", response_model=ReportResponse)
def update_report(
    report_id: str,
    data: ReportUpdate,
    _: dict = Depends(get_admin_user),
):
    row = report_service.update_report(report_id, data.status)
    if not row:
        raise HTTPException(status_code=404, detail=REPORT_NOT_FOUND)
    return row
