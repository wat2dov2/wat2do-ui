import logging

from fastapi import APIRouter, Depends, status

from core.auth import get_admin_user, get_current_user, resolve_db_user
from schemas.credit import (
    AddCreditsRequest,
    CreditBalanceResponse,
    PromotionCreate,
    PromotionResponse,
)
from services import credit_service

router = APIRouter(tags=["credits"])
log = logging.getLogger(__name__)


# ── Credits ──────────────────────────────────────────────────────────


@router.get("/credits/", response_model=CreditBalanceResponse)
def get_credits(auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    balance = credit_service.get_balance(str(user.id))
    return CreditBalanceResponse(balance=balance)


@router.post("/credits/add", response_model=CreditBalanceResponse)
def add_credits(data: AddCreditsRequest, _: dict = Depends(get_admin_user)):
    """Admin-only: add credits to a target user's balance."""
    new_balance = credit_service.add_credits(data.user_id, data.amount)
    return CreditBalanceResponse(balance=new_balance)


# ── Promotions ───────────────────────────────────────────────────────


@router.get("/promotions/", response_model=list[PromotionResponse])
def list_promotions(auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    return credit_service.get_user_promotions(str(user.id))


@router.post("/promotions/", response_model=PromotionResponse, status_code=status.HTTP_201_CREATED)
def create_promotion(data: PromotionCreate, auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    return credit_service.create_promotion(
        user_id=str(user.id),
        event_id=data.event_id,
        package=data.package,
    )


@router.get("/promotions/active-ids", response_model=list[int])
def get_active_promoted_ids():
    """Public endpoint — returns event IDs with active promotions."""
    return credit_service.get_active_promoted_event_ids()
