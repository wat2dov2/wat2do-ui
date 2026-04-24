import logging

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_authorized_resource, get_current_user, get_db_user
from core.errors import EVENT_ALREADY_PAST, EVENT_NOT_FOUND
from core.exceptions import ValidationError
from core.rate_limit import RateLimiter
from schemas.credit import (
    AddCreditsRequest,
    CreditBalanceResponse,
    PromotionCreate,
    PromotionResponse,
)
from services import credit_service, event_service

router = APIRouter(tags=["credits"])
log = logging.getLogger(__name__)


# C8: sensitive credit mutations get a dedicated per-user rate limiter.
# 10 requests / 60 s matches other sensitive paths (ai_rate_limiter) and is
# tight enough to cap abuse while leaving plenty of headroom for legitimate
# retries.  Keyed by user ID so one bad IP cannot DoS others on the same
# network.
credit_mutation_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)


def _user_id_key(user: dict = Depends(get_current_user)) -> str:
    return user["id"]


# ── Credits ──────────────────────────────────────────────────────────


@router.get("/credits/", response_model=CreditBalanceResponse)
def get_credits(user=Depends(get_db_user)):
    balance = credit_service.get_balance(str(user.id))
    return CreditBalanceResponse(balance=balance)


@router.post("/credits/add", response_model=CreditBalanceResponse)
def add_credits(
    data: AddCreditsRequest,
    _: dict = Depends(get_admin_user),
    _rl: None = Depends(credit_mutation_rate_limiter.dependency(key_func=_user_id_key)),
):
    """Admin-only: add credits to a target user's balance."""
    new_balance = credit_service.add_credits(str(data.user_id), data.amount)
    return CreditBalanceResponse(balance=new_balance)


# ── Promotions ───────────────────────────────────────────────────────


@router.get("/promotions/", response_model=list[PromotionResponse])
def list_promotions(
    user=Depends(get_db_user),
    active: bool | None = Query(
        None,
        description="If set, filter by active (True) or expired (False) promotions.",
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return credit_service.get_user_promotions(
        str(user.id),
        active=active,
        limit=limit,
        offset=offset,
    )


@router.post("/promotions/", response_model=PromotionResponse, status_code=status.HTTP_201_CREATED)
def create_promotion(
    data: PromotionCreate,
    user=Depends(get_db_user),
    _rl: None = Depends(credit_mutation_rate_limiter.dependency(key_func=_user_id_key)),
):
    event = get_authorized_resource(
        lambda: event_service.get_event(data.event_id), EVENT_NOT_FOUND, user,
    )
    # I6: reject promotions on events that have already ended so users
    # cannot burn credits on posters that will never surface again.
    if event_service.has_ended(event):
        raise ValidationError(EVENT_ALREADY_PAST)
    return credit_service.create_promotion(
        user_id=str(user.id),
        event_id=data.event_id,
        package=data.package,
    )


@router.get("/promotions/active-ids", response_model=list[int])
def get_active_promoted_ids():
    """Public endpoint — returns event IDs with active promotions."""
    return credit_service.get_active_promoted_event_ids()
