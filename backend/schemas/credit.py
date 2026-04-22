from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from core.constants import MAX_CREDITS_PER_ADD

PromotionPackage = Literal["featured", "email", "combo"]


class CreditRow(BaseModel):
    """Internal representation of a user_credits row."""
    id: str
    user_id: str
    balance: int


class CreditBalanceResponse(BaseModel):
    balance: int


class AddCreditsRequest(BaseModel):
    # C13: use UUID for type-safe validation so malformed strings are rejected
    # at the Pydantic boundary (422) instead of surfacing as opaque Postgres
    # errors deeper down.
    user_id: UUID = Field(..., description="Target user ID to receive credits")
    amount: int = Field(..., gt=0, le=MAX_CREDITS_PER_ADD)


class PromotionCreate(BaseModel):
    event_id: int
    package: PromotionPackage


class PromotionResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    package: PromotionPackage
    credits_spent: int
    # Datetimes parsed via Pydantic v2 (audit S9).  Column types in the
    # DB are TIMESTAMPTZ so ISO-8601 strings round-trip cleanly.
    start_date: datetime
    end_date: datetime
    created_at: datetime
