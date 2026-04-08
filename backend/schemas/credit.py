from typing import Literal

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
    user_id: str = Field(..., description="Target user ID to receive credits")
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
    start_date: str
    end_date: str
    created_at: str
