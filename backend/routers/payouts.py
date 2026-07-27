"""User payout history and administrator payout operations."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user, get_db_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.payout import (
    AdminPayoutDetail,
    PayoutCsvExportResponse,
    PayoutFraudStatus,
    PayoutSelectionRequest,
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
    payout_email: str | None = Query(default=None, max_length=320),
    period_from: date | None = None,
    period_to: date | None = None,
    min_amount_cents: int | None = Query(default=None, ge=0),
    max_amount_cents: int | None = Query(default=None, ge=0),
    fraud_status: PayoutFraudStatus | None = None,
    pagination: PaginationParams = Depends(),
    _admin: UserResponse = Depends(get_admin_user),
):
    items, total = poster_payout_service.list_admin_payouts(
        user_id=str(user_id) if user_id else None,
        status=payout_status,
        period=period,
        payout_email=payout_email,
        period_from=period_from,
        period_to=period_to,
        minimum_amount_cents=min_amount_cents,
        maximum_amount_cents=max_amount_cents,
        fraud_status=fraud_status,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.post("/admin/export", response_model=PayoutCsvExportResponse)
def export_pending_payouts(
    data: PayoutSelectionRequest,
    _admin: UserResponse = Depends(get_admin_user),
):
    payouts = poster_payout_service.get_pending_payouts_for_export(data.payout_ids)
    periods = {payout.period for payout in payouts}
    filename = (
        f"poster-payouts-{next(iter(periods)):%Y-%m}.csv"
        if len(periods) == 1
        else "poster-payouts-export.csv"
    )
    return PayoutCsvExportResponse(
        filename=filename,
        content=poster_payout_service.serialize_interac_csv(payouts),
    )


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
    data: PayoutSelectionRequest,
    admin: UserResponse = Depends(get_admin_user),
):
    return poster_payout_service.bulk_mark_paid(
        data.payout_ids,
        reviewed_by=admin.id,
    )
