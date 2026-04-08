"""Credits and event promotions persistence.

Credit mutations (add / deduct) use PostgreSQL RPC functions that perform
the balance check and update in a single atomic statement, preventing the
TOCTOU race condition that would allow double-spending under concurrency.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from core.constants import DEFAULT_CREDIT_BALANCE, PROMOTION_PACKAGES
from core.database import get_sb
from core.errors import INSUFFICIENT_CREDITS, INVALID_PROMOTION_PACKAGE
from core.tables import EVENT_PROMOTIONS
from schemas.credit import PromotionResponse

log = logging.getLogger(__name__)

# Sentinel returned by the adjust_credits DB function when funds are insufficient.
_INSUFFICIENT_FUNDS_SENTINEL = -1


def get_balance(user_id: str) -> int:
    """Return the user's credit balance, creating the row if needed."""
    r = get_sb().rpc(
        "ensure_user_credits",
        {"p_user_id": user_id, "p_default_balance": DEFAULT_CREDIT_BALANCE},
    ).execute()
    return r.data


def add_credits(user_id: str, amount: int) -> int:
    """Atomically add credits to a user's balance. Returns the new balance."""
    r = get_sb().rpc(
        "adjust_credits",
        {
            "p_user_id": user_id,
            "p_amount": amount,
            "p_default_balance": DEFAULT_CREDIT_BALANCE,
        },
    ).execute()
    return r.data


def deduct_credits(user_id: str, amount: int) -> int:
    """Atomically deduct credits. Raises 400 if insufficient funds."""
    r = get_sb().rpc(
        "adjust_credits",
        {
            "p_user_id": user_id,
            "p_amount": -amount,
            "p_default_balance": DEFAULT_CREDIT_BALANCE,
        },
    ).execute()
    new_balance = r.data
    if new_balance == _INSUFFICIENT_FUNDS_SENTINEL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INSUFFICIENT_CREDITS,
        )
    return new_balance


def create_promotion(
    user_id: str,
    event_id: int,
    package: str,
) -> PromotionResponse:
    """Create an event promotion.

    Looks up the credit cost and duration from ``PROMOTION_PACKAGES`` so the
    client cannot control pricing.  Raises 400 for unknown packages.
    """
    pkg = PROMOTION_PACKAGES.get(package)
    if pkg is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INVALID_PROMOTION_PACKAGE,
        )
    credits_cost, duration_days = pkg

    deduct_credits(user_id, credits_cost)

    now = datetime.now(timezone.utc)
    end = now + timedelta(days=duration_days)

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
        "package": package,
        "credits_spent": credits_cost,
        "start_date": now.isoformat(),
        "end_date": end.isoformat(),
    }
    r = get_sb().table(EVENT_PROMOTIONS).insert(payload).execute()
    return PromotionResponse.model_validate(r.data[0]) if r.data else PromotionResponse(**payload)


def get_user_promotions(user_id: str) -> list[PromotionResponse]:
    """Return all promotions for a user, newest first."""
    r = (
        get_sb()
        .table(EVENT_PROMOTIONS)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [PromotionResponse.model_validate(row) for row in (r.data or [])]


def get_active_promoted_event_ids() -> list[int]:
    """Return event IDs with currently active promotions."""
    now = datetime.now(timezone.utc).isoformat()
    r = (
        get_sb()
        .table(EVENT_PROMOTIONS)
        .select("event_id")
        .gte("end_date", now)
        .execute()
    )
    return list({row["event_id"] for row in (r.data or [])})
