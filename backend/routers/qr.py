"""QR code creation, redirect resolution, scan confirmation, and earnings."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from core.auth import (
    get_authorized_resource,
    get_club_owner_or_admin,
    get_db_user,
    is_admin,
)
from core.client_ip import get_client_ip
from core.config import settings
from core.constants import MAX_SCHOOL_LENGTH, MAX_USER_AGENT_LENGTH
from core.errors import ID_MISMATCH, INVALID_SCAN_CONFIRMATION, POSTER_NOT_FOUND
from core.exceptions import ValidationError
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import qr_scan_rate_limiter
from schemas.qr_code import (
    CampusCoverageResponse,
    PromoterEarningsResponse,
    PromoterPosterBatchCreate,
    PromoterPosterBatchResponse,
    QrCodeCreate,
    QrCodeRedirect,
    QrCodeResponse,
    QrCodeScanResponse,
    QrCodeUpdate,
    QrProgram,
    QrScanConfirmRequest,
    QrScanConfirmResponse,
)
from schemas.user import UserResponse
from services import poster_payout_service, qr_code_service

router = APIRouter(prefix="/qr", tags=["qr"])

_VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2
_MAX_VISITOR_TOKEN_LENGTH = 256


def _qr_scan_rate_limit_key(request: Request) -> str:
    """Keep raw viewer IPs out of rate-limit warning logs."""
    return qr_code_service.hash_client_ip(get_client_ip(request))


def _get_poster_or_404_authorized(
    qr_code_id: str,
    db_user: UserResponse,
) -> QrCodeResponse:
    return get_authorized_resource(
        lambda: qr_code_service.get_qr_code_by_id(qr_code_id),
        POSTER_NOT_FOUND,
        db_user,
    )


def _get_or_create_visitor_token(request: Request, response: Response) -> str:
    token = request.cookies.get(qr_code_service.POSTER_VISITOR_COOKIE)
    if not token or len(token) > _MAX_VISITOR_TOKEN_LENGTH:
        token = qr_code_service.new_visitor_token()
        response.set_cookie(
            key=qr_code_service.POSTER_VISITOR_COOKIE,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure or settings.is_production,
            path=settings.poster_visitor_cookie_path,
            max_age=_VISITOR_COOKIE_MAX_AGE,
            domain=settings.cookie_domain or None,
        )
    return token


@router.get("/", response_model=PaginatedResponse[QrCodeResponse])
def list_qr_codes(
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    program: QrProgram | None = None,
    is_active: bool | None = None,
    latest_scan_before: datetime | None = None,
    latest_scan_after: datetime | None = None,
    never_scanned: bool | None = None,
    pagination: PaginationParams = Depends(),
    db_user: UserResponse = Depends(get_db_user),
):
    """List manageable QR codes with explicit active-state and recency filters."""
    if not is_admin(db_user):
        enrolled = db_user.promoter_tos_accepted_at is not None
        if not enrolled:
            get_club_owner_or_admin(db_user)
    kwargs = {
        "offset": pagination.offset,
        "limit": pagination.page_size,
        "school": school,
        "program": program,
        "is_active": is_active,
        "latest_scan_before": latest_scan_before,
        "latest_scan_after": latest_scan_after,
        "never_scanned": never_scanned,
    }
    if not is_admin(db_user):
        kwargs["created_by"] = str(db_user.id)
    items, total = qr_code_service.list_qr_codes(**kwargs)
    return paginated_response(items, total, pagination)


@router.get("/scans", response_model=PaginatedResponse[QrCodeScanResponse])
def list_scans(
    qr_code_id: str | None = Query(None, max_length=128),
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    pagination: PaginationParams = Depends(),
    db_user: UserResponse = Depends(get_club_owner_or_admin),
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


@router.get("/earnings", response_model=PromoterEarningsResponse)
def get_promoter_earnings(db_user: UserResponse = Depends(get_db_user)):
    return poster_payout_service.get_promoter_earnings(db_user)


@router.post("/scans/confirm", response_model=QrScanConfirmResponse)
def confirm_scan(
    data: QrScanConfirmRequest,
    request: Request,
):
    visitor_token = request.cookies.get(qr_code_service.POSTER_VISITOR_COOKIE)
    if not visitor_token or len(visitor_token) > _MAX_VISITOR_TOKEN_LENGTH:
        raise ValidationError(INVALID_SCAN_CONFIRMATION)
    return qr_code_service.confirm_scan(data.token, visitor_token=visitor_token)


@router.get("/map", response_model=CampusCoverageResponse)
def get_campus_coverage(
    school: str = Query(min_length=1, max_length=MAX_SCHOOL_LENGTH),
):
    return qr_code_service.get_campus_coverage(school)


@router.get("/{qr_code_id}", response_model=QrCodeRedirect)
def resolve_qr_and_record_scan(
    qr_code_id: str,
    request: Request,
    response: Response,
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    _rl: None = Depends(qr_scan_rate_limiter.dependency(key_func=_qr_scan_rate_limit_key)),
):
    visitor_token = _get_or_create_visitor_token(request, response)
    user_agent = request.headers.get("user-agent")
    return qr_code_service.handle_scan(
        qr_code_id,
        lat=lat,
        lon=lon,
        visitor_token=visitor_token,
        client_ip=get_client_ip(request),
        user_agent=user_agent[:MAX_USER_AGENT_LENGTH] if user_agent else None,
    )


@router.post(
    "/",
    response_model=QrCodeResponse | PromoterPosterBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_poster(
    data: QrCodeCreate | PromoterPosterBatchCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    if isinstance(data, QrCodeCreate):
        get_club_owner_or_admin(db_user)
        return qr_code_service.create_qr_code(data, creator=db_user)
    return PromoterPosterBatchResponse(
        posters=qr_code_service.create_promoter_qr_codes(data, creator=db_user)
    )


@router.patch("/{qr_code_id}", response_model=QrCodeResponse)
def update_poster(
    qr_code_id: str,
    data: QrCodeUpdate,
    db_user: UserResponse = Depends(get_club_owner_or_admin),
):
    if data.id != qr_code_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ID_MISMATCH)
    existing = _get_poster_or_404_authorized(qr_code_id, db_user)
    return qr_code_service.update_qr_code(data, existing=existing)


@router.delete("/{qr_code_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_poster(
    qr_code_id: str,
    db_user: UserResponse = Depends(get_club_owner_or_admin),
):
    _get_poster_or_404_authorized(qr_code_id, db_user)
    qr_code_service.delete_qr_code(qr_code_id)
