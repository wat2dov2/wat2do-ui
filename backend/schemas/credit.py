from pydantic import BaseModel


class CreditRow(BaseModel):
    """Internal representation of a user_credits row."""
    id: str
    user_id: str
    balance: int


class CreditBalanceResponse(BaseModel):
    balance: int


class AddCreditsRequest(BaseModel):
    amount: int


class PromotionCreate(BaseModel):
    event_id: int
    package: str  # "featured" | "email" | "combo"
    credits: int
    duration: int  # days


class PromotionResponse(BaseModel):
    id: str
    user_id: str
    event_id: int
    package: str
    credits_spent: int
    start_date: str
    end_date: str
    created_at: str
