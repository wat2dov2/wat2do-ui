"""QR code redirect and scan recording. Public GET /qr/{id} records a scan and returns redirect config."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import get_current_user
from core.database import get_db
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse
from services import qr_code_service

router = APIRouter(prefix="/qr", tags=["qr"])


@router.get("/", response_model=list[QrCodeResponse])
async def list_qr_codes(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List all QR codes for the dashboard. Requires auth."""
    return await qr_code_service.list_qr_codes(db)


@router.get("/scans", response_model=list[QrCodeScanResponse])
async def list_scans(
    qr_code_id: str | None = Query(None, description="Filter by QR code id"),
    from_time: datetime | None = Query(None, description="Scans from this time (inclusive)"),
    to_time: datetime | None = Query(None, description="Scans until this time (inclusive)"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List scans for the dashboard. Requires auth."""
    return await qr_code_service.list_scans(
        db, qr_code_id=qr_code_id, from_time=from_time, to_time=to_time
    )


@router.get("/{qr_code_id}")
async def resolve_qr_and_record_scan(
    qr_code_id: str,
    request: Request,
    lat: float | None = Query(None, description="Scanner latitude (required for first scan to activate poster)"),
    lon: float | None = Query(None, description="Scanner longitude (required for first scan to activate poster)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve a poster by id. If poster is inactive (no first scan yet), lat/lon are required:
    this scan calibrates the poster location and activates it. If poster is active, just record the scan.
    Returns redirect config, or 202 with requires_location when poster is inactive and no lat/lon provided.
    No auth required.
    """
    qr = await qr_code_service.get_qr_code_by_id(db, qr_code_id)
    if not qr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster not found")

    session_id = request.headers.get("x-session-id") or str(uuid.uuid4())
    user_agent = request.headers.get("user-agent")
    user_agent_trunc = user_agent[:512] if user_agent else None

    if not qr.is_active:
        if lat is not None and lon is not None:
            redirect_config = await qr_code_service.activate_poster_and_record_scan(
                db, qr_code_id, lat, lon, session_id=session_id, user_agent=user_agent_trunc
            )
            if redirect_config:
                return redirect_config
        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail="requires_location",
        )

    await qr_code_service.record_scan(
        db, qr_code_id, session_id=session_id, user_agent=user_agent_trunc
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
async def create_poster(
    data: QrCodeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Create a poster (inactive until first scan provides location). Requires auth."""
    return await qr_code_service.upsert_qr_code(db, data)


@router.patch("/{qr_code_id}", response_model=QrCodeResponse)
async def update_poster(
    qr_code_id: str,
    data: QrCodeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Update a poster. Requires auth."""
    if data.id != qr_code_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID mismatch")
    return await qr_code_service.upsert_qr_code(db, data)


@router.delete("/{qr_code_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_poster(
    qr_code_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete a poster and its scans. Requires auth."""
    try:
        await qr_code_service.delete_qr_code(db, qr_code_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster not found")
