"""User payout history and administrator payout operations."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends

from core.auth import get_admin_user, get_db_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.payout import (
    AdminPayoutDetail,
    BulkMarkPaidRequest,
    PayoutStatus,
    PayoutStatusUpdate,
    PosterPayoutResponse,
    UserPosterPayoutResponse,
)
from schemas.user import UserResponse
from services import poster_payout_service

router = APIRouter(prefix="/payouts", tags=["payouts"])


@router.get("/", response_model=PaginatedResponse[UserPosterPayoutResponse])
def list_own_payouts(
    payout_status: PayoutStatus | None = None,
    pagination: PaginationParams = Depends(),
    user: UserResponse = Depends(get_db_user),
):
    items, total = poster_payout_service.list_user_payouts(
        str(user.id),
        status=payout_status,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/admin", response_model=PaginatedResponse[PosterPayoutResponse])
def list_admin_payouts(
    user_id: UUID | None = None,
    payout_status: PayoutStatus | None = None,
    period: date | None = None,
    pagination: PaginationParams = Depends(),
    _admin: UserResponse = Depends(get_admin_user),
):
    items, total = poster_payout_service.list_admin_payouts(
        user_id=str(user_id) if user_id else None,
        status=payout_status,
        period=period,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/admin/{payout_id}", response_model=AdminPayoutDetail)
def get_admin_payout_detail(
    payout_id: UUID,
    _admin: UserResponse = Depends(get_admin_user),
):
    return poster_payout_service.get_admin_payout_detail(payout_id)


@router.patch("/admin/{payout_id}/status", response_model=PosterPayoutResponse)
def transition_payout(
    payout_id: UUID,
    data: PayoutStatusUpdate,
    admin: UserResponse = Depends(get_admin_user),
):
    return poster_payout_service.transition_payout(
        payout_id,
        target_status=data.status,
        notes=data.notes,
        reviewed_by=admin.id,
    )


@router.post("/admin/mark-paid", response_model=list[PosterPayoutResponse])
def bulk_mark_paid(
    data: BulkMarkPaidRequest,
    admin: UserResponse = Depends(get_admin_user),
):
    return poster_payout_service.bulk_mark_paid(
        data.payout_ids,
        reviewed_by=admin.id,
    )
