"""QR code redirect and scan recording. Public GET /qr/{id} records a scan and returns redirect config."""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from core.auth import get_authorized_resource, get_db_user, is_admin
from schemas.user import UserResponse
from core.constants import MAX_SESSION_ID_LENGTH, MAX_USER_AGENT_LENGTH

log = logging.getLogger(__name__)
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import qr_scan_rate_limiter
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse
from core.errors import ID_MISMATCH, POSTER_NOT_FOUND
from services import qr_code_service

router = APIRouter(prefix="/qr", tags=["qr"])


def _get_poster_or_404_authorized(qr_code_id: str, db_user: UserResponse) -> QrCodeResponse:
    """Fetch a poster by ID (404 if missing) and verify the user is its owner or an admin (403 if not)."""
    return get_authorized_resource(
        lambda: qr_code_service.get_qr_code_by_id(qr_code_id), POSTER_NOT_FOUND, db_user,
    )


@router.get("/", response_model=PaginatedResponse[QrCodeResponse])
def list_qr_codes(
    pagination: PaginationParams = Depends(),
    db_user: UserResponse = Depends(get_db_user),
):
    if is_admin(db_user):
        items, total = qr_code_service.list_qr_codes(
            offset=pagination.offset,
            limit=pagination.page_size,
        )
    else:
        items, total = qr_code_service.list_qr_codes(
            created_by=str(db_user.id),
            offset=pagination.offset,
            limit=pagination.page_size,
        )
    return paginated_response(items, total, pagination)


@router.get("/scans", response_model=PaginatedResponse[QrCodeScanResponse])
def list_scans(
    qr_code_id: str | None = Query(None, max_length=128, description="Filter by QR code id"),
    from_time: datetime | None = Query(None, description="Scans from this time (inclusive)"),
    to_time: datetime | None = Query(None, description="Scans until this time (inclusive)"),
    pagination: PaginationParams = Depends(),
    db_user: UserResponse = Depends(get_db_user),
):
    owned_by = None if is_admin(db_user) else str(db_user.id)
    items, total = qr_code_service.list_scans(
        qr_code_id=qr_code_id,
        from_time=from_time,
        to_time=to_time,
        owned_by=owned_by,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/{qr_code_id}", response_model=QrCodeRedirect)
def resolve_qr_and_record_scan(
    qr_code_id: str,
    request: Request,
    lat: float | None = Query(None, ge=-90, le=90, description="Scanner latitude (required for first scan to activate poster)"),
    lon: float | None = Query(None, ge=-180, le=180, description="Scanner longitude (required for first scan to activate poster)"),
    _rl: None = Depends(qr_scan_rate_limiter.ip_dependency()),
):
    session_id_raw = request.headers.get("x-session-id")
    if session_id_raw and len(session_id_raw) > MAX_SESSION_ID_LENGTH:
        session_id_raw = session_id_raw[:MAX_SESSION_ID_LENGTH]
    session_id = session_id_raw or str(uuid.uuid4())
    user_agent = request.headers.get("user-agent")
    user_agent_trunc = user_agent[:MAX_USER_AGENT_LENGTH] if user_agent else None

    return qr_code_service.handle_scan(
        qr_code_id,
        lat=lat,
        lon=lon,
        session_id=session_id,
        user_agent=user_agent_trunc,
    )


@router.post("/", response_model=QrCodeResponse, status_code=status.HTTP_201_CREATED)
def create_poster(
    data: QrCodeCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    # INSERT-only: if the id already exists, create_qr_code raises
    # ConflictError -> 409.  Previously this was an upsert which allowed
    # any authenticated user to hijack an existing poster by guessing its
    # id and reposting with their own destination_id.
    return qr_code_service.create_qr_code(data, created_by=str(db_user.id))


@router.patch("/{qr_code_id}", response_model=QrCodeResponse)
def update_poster(
    qr_code_id: str,
    data: QrCodeCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    if data.id != qr_code_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ID_MISMATCH)
    existing = _get_poster_or_404_authorized(qr_code_id, db_user)
    # Pass the trusted original created_by so a PATCH body cannot
    # transfer ownership to a different user.
    return qr_code_service.update_qr_code(data, created_by=existing.created_by)


@router.delete("/{qr_code_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_poster(
    qr_code_id: str,
    db_user: UserResponse = Depends(get_db_user),
):
    _get_poster_or_404_authorized(qr_code_id, db_user)
    qr_code_service.delete_qr_code(qr_code_id)
