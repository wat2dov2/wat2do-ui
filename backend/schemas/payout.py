"""Pydantic contracts for promoter poster payouts."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PayoutStatus = Literal["pending", "held", "paid", "voided"]


class UserPosterPayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    period: date
    payout_email: EmailStr
    rate_cents: int
    amount_cents: int
    scan_count: int
    status: PayoutStatus
    paid_at: datetime | None
    created_at: datetime


class PosterPayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    period: date
    payout_email: EmailStr
    rate_cents: int
    amount_cents: int
    scan_count: int
    status: PayoutStatus
    paid_at: datetime | None
    notes: str | None
    reviewed_by: UUID | None
    created_at: datetime
    updated_at: datetime


class PayoutStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: PayoutStatus
    notes: str | None = Field(default=None, max_length=10_000)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class BulkMarkPaidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payout_ids: list[UUID] = Field(min_length=1, max_length=1000)


class PayoutFraudReason(BaseModel):
    code: str
    points: int
    affected_scan_count: int
    evidence: dict


class AdminPayoutDetail(BaseModel):
    payout: PosterPayoutResponse
    fraud_reasons: list[PayoutFraudReason]
