"""Credits and event promotions persistence."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from core.database import get_sb
from schemas.credit import CreditRow, PromotionResponse

DEFAULT_BALANCE = 100


def get_or_create_credits(user_id: str) -> CreditRow:
    """Return the credits row for a user, creating one if it doesn't exist."""
    r = (
        get_sb()
        .table("user_credits")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if r.data:
        return CreditRow.model_validate(r.data[0])

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "balance": DEFAULT_BALANCE,
    }
    r = (
        get_sb()
        .table("user_credits")
        .insert(payload)
        .execute()
    )
    return CreditRow.model_validate(r.data[0]) if r.data else CreditRow(**payload)


def get_balance(user_id: str) -> int:
    """Return the user's credit balance."""
    row = get_or_create_credits(user_id)
    return row.balance


def add_credits(user_id: str, amount: int) -> int:
    """Add credits to a user's balance. Returns the new balance."""
    row = get_or_create_credits(user_id)
    new_balance = row.balance + amount
    get_sb().table("user_credits").update(
        {"balance": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("user_id", user_id).execute()
    return new_balance


def deduct_credits(user_id: str, amount: int) -> int:
    """Deduct credits from a user's balance. Raises 400 if insufficient."""
    row = get_or_create_credits(user_id)
    if row.balance < amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insufficient credits",
        )
    new_balance = row.balance - amount
    get_sb().table("user_credits").update(
        {"balance": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("user_id", user_id).execute()
    return new_balance


def create_promotion(
    user_id: str,
    event_id: int,
    package: str,
    credits: int,
    duration: int,
) -> PromotionResponse:
    """Create an event promotion. Deducts credits and inserts the promotion row."""
    deduct_credits(user_id, credits)

    now = datetime.now(timezone.utc)
    end = now + timedelta(days=duration)

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event_id": event_id,
        "package": package,
        "credits_spent": credits,
        "start_date": now.isoformat(),
        "end_date": end.isoformat(),
    }
    r = get_sb().table("event_promotions").insert(payload).execute()
    return PromotionResponse.model_validate(r.data[0]) if r.data else PromotionResponse(**payload)


def get_user_promotions(user_id: str) -> list[PromotionResponse]:
    """Return all promotions for a user, newest first."""
    r = (
        get_sb()
        .table("event_promotions")
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
        .table("event_promotions")
        .select("event_id")
        .gte("end_date", now)
        .execute()
    )
    return list({row["event_id"] for row in (r.data or [])})
