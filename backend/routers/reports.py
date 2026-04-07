import logging

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user, get_admin_user
from schemas.report import ReportCreate, ReportUpdate, ReportResponse
from services import report_service, user_service

router = APIRouter(prefix="/reports", tags=["reports"])
log = logging.getLogger(__name__)


def _resolve_db_user(auth_user: dict):
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@router.post("/", response_model=ReportResponse, status_code=201)
def create_report(data: ReportCreate, auth_user: dict = Depends(get_current_user)):
    user = _resolve_db_user(auth_user)
    row = report_service.create_report(str(user.id), data.event_id, data.reason)
    return ReportResponse(**row)


@router.get("/", response_model=list[ReportResponse])
def list_reports(
    report_status: str | None = None,
    _: dict = Depends(get_admin_user),
):
    rows = report_service.get_reports(status=report_status)
    return [ReportResponse(**row) for row in rows]


@router.patch("/{report_id}", response_model=ReportResponse)
def update_report(
    report_id: str,
    data: ReportUpdate,
    _: dict = Depends(get_admin_user),
):
    row = report_service.update_report(report_id, data.status)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return ReportResponse(**row)
