"""QR code redirect and scan recording. Public GET /qr/{id} records a scan and returns redirect config."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from core.auth import get_current_user, is_admin, require_owner_or_admin
from core.constants import MAX_USER_AGENT_LENGTH
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import qr_scan_rate_limiter
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse
from core.errors import ID_MISMATCH, POSTER_NOT_FOUND, REQUIRES_LOCATION
from services import qr_code_service

router = APIRouter(prefix="/qr", tags=["qr"])


@router.get("/", response_model=PaginatedResponse[QrCodeResponse])
def list_qr_codes(
    pagination: PaginationParams = Depends(),
    user: dict = Depends(get_current_user),
):
    if is_admin(user):
        items, total = qr_code_service.list_qr_codes(
            offset=pagination.offset,
            limit=pagination.page_size,
        )
    else:
        items, total = qr_code_service.list_qr_codes(
            created_by=user["id"],
            offset=pagination.offset,
            limit=pagination.page_size,
        )
    return paginated_response(items, total, pagination)


@router.get("/scans", response_model=PaginatedResponse[QrCodeScanResponse])
def list_scans(
    qr_code_id: str | None = Query(None, description="Filter by QR code id"),
    from_time: datetime | None = Query(None, description="Scans from this time (inclusive)"),
    to_time: datetime | None = Query(None, description="Scans until this time (inclusive)"),
    pagination: PaginationParams = Depends(),
    user: dict = Depends(get_current_user),
):
    owned_by = None if is_admin(user) else user["id"]
    items, total = qr_code_service.list_scans(
        qr_code_id=qr_code_id,
        from_time=from_time,
        to_time=to_time,
        owned_by=owned_by,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/{qr_code_id}")
def resolve_qr_and_record_scan(
    qr_code_id: str,
    request: Request,
    lat: float | None = Query(None, description="Scanner latitude (required for first scan to activate poster)"),
    lon: float | None = Query(None, description="Scanner longitude (required for first scan to activate poster)"),
    _rl: None = Depends(qr_scan_rate_limiter.ip_dependency()),
):
    qr = qr_code_service.get_qr_code_by_id(qr_code_id)
    if not qr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=POSTER_NOT_FOUND)

    session_id = request.headers.get("x-session-id") or str(uuid.uuid4())
    user_agent = request.headers.get("user-agent")
    user_agent_trunc = user_agent[:MAX_USER_AGENT_LENGTH] if user_agent else None

    if not qr.is_active:
        if lat is not None and lon is not None:
            redirect_config = qr_code_service.activate_poster_and_record_scan(
                qr_code_id, lat, lon, session_id=session_id, user_agent=user_agent_trunc
            )
            if redirect_config:
                return redirect_config
        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail=REQUIRES_LOCATION,
        )

    qr_code_service.record_scan(
        qr_code_id, session_id=session_id, user_agent=user_agent_trunc
    )
    dest_id = qr.destination_id
    if qr.destination_type == "event" and dest_id is not None:
        try:
            dest_id = int(dest_id)
        except (TypeError, ValueError):
            pass
    return QrCodeRedirect(
        destination_type=qr.destination_type,
        destination_id=dest_id,
        filters=qr.filters,
    )


@router.post("/", response_model=QrCodeResponse, status_code=status.HTTP_201_CREATED)
def create_poster(
    data: QrCodeCreate,
    user: dict = Depends(get_current_user),
):
    return qr_code_service.upsert_qr_code(data, created_by=user["id"])


@router.patch("/{qr_code_id}", response_model=QrCodeResponse)
def update_poster(
    qr_code_id: str,
    data: QrCodeCreate,
    user: dict = Depends(get_current_user),
):
    if data.id != qr_code_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ID_MISMATCH)
    existing = qr_code_service.get_qr_code_by_id(qr_code_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=POSTER_NOT_FOUND)
    require_owner_or_admin(user, existing.created_by)
    return qr_code_service.upsert_qr_code(data, created_by=existing.created_by)


@router.delete("/{qr_code_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_poster(
    qr_code_id: str,
    user: dict = Depends(get_current_user),
):
    existing = qr_code_service.get_qr_code_by_id(qr_code_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=POSTER_NOT_FOUND)
    require_owner_or_admin(user, existing.created_by)
    qr_code_service.delete_qr_code(qr_code_id)
