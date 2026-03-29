"""QR code redirect and scan recording. Public GET /qr/{id} records a scan and returns redirect config."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from core.auth import get_current_user
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse
from services import qr_code_service

router = APIRouter(prefix="/qr", tags=["qr"])


@router.get("/", response_model=list[QrCodeResponse])
def list_qr_codes(_: dict = Depends(get_current_user)):
    return qr_code_service.list_qr_codes()


@router.get("/scans", response_model=list[QrCodeScanResponse])
def list_scans(
    qr_code_id: str | None = Query(None, description="Filter by QR code id"),
    from_time: datetime | None = Query(None, description="Scans from this time (inclusive)"),
    to_time: datetime | None = Query(None, description="Scans until this time (inclusive)"),
    _: dict = Depends(get_current_user),
):
    return qr_code_service.list_scans(
        qr_code_id=qr_code_id, from_time=from_time, to_time=to_time
    )


@router.get("/{qr_code_id}")
def resolve_qr_and_record_scan(
    qr_code_id: str,
    request: Request,
    lat: float | None = Query(None, description="Scanner latitude (required for first scan to activate poster)"),
    lon: float | None = Query(None, description="Scanner longitude (required for first scan to activate poster)"),
):
    qr = qr_code_service.get_qr_code_by_id(qr_code_id)
    if not qr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster not found")

    session_id = request.headers.get("x-session-id") or str(uuid.uuid4())
    user_agent = request.headers.get("user-agent")
    user_agent_trunc = user_agent[:512] if user_agent else None

    if not qr.get("is_active"):
        if lat is not None and lon is not None:
            redirect_config = qr_code_service.activate_poster_and_record_scan(
                qr_code_id, lat, lon, session_id=session_id, user_agent=user_agent_trunc
            )
            if redirect_config:
                return redirect_config
        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail="requires_location",
        )

    qr_code_service.record_scan(
        qr_code_id, session_id=session_id, user_agent=user_agent_trunc
    )
    dest_id = qr.get("destination_id")
    if qr.get("destination_type") == "event" and dest_id is not None:
        try:
            dest_id = int(dest_id)
        except (TypeError, ValueError):
            pass
    return QrCodeRedirect(
        destination_type=qr["destination_type"],
        destination_id=dest_id,
        filters=qr.get("filters"),
    )


@router.post("/", response_model=QrCodeResponse, status_code=status.HTTP_201_CREATED)
def create_poster(
    data: QrCodeCreate,
    _: dict = Depends(get_current_user),
):
    return qr_code_service.upsert_qr_code(data)


@router.patch("/{qr_code_id}", response_model=QrCodeResponse)
def update_poster(
    qr_code_id: str,
    data: QrCodeCreate,
    _: dict = Depends(get_current_user),
):
    if data.id != qr_code_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID mismatch")
    return qr_code_service.upsert_qr_code(data)


@router.delete("/{qr_code_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_poster(
    qr_code_id: str,
    _: dict = Depends(get_current_user),
):
    try:
        qr_code_service.delete_qr_code(qr_code_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster not found")
