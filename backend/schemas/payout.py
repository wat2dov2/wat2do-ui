"""Pydantic contracts for promoter poster payouts."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

PayoutStatus = Literal["pending", "held", "paid", "voided"]
PayoutFraudStatus = Literal["flagged", "clear"]
_SPREADSHEET_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def _validate_payout_email(value: EmailStr) -> EmailStr:
    if str(value).startswith(_SPREADSHEET_FORMULA_PREFIXES):
        raise ValueError("payout email cannot begin with a spreadsheet formula character")
    return value


PayoutEmail = Annotated[EmailStr, AfterValidator(_validate_payout_email)]


class UserPosterPayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    period: date
    payout_email: PayoutEmail
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
    payout_email: PayoutEmail
    rate_cents: int
    amount_cents: int
    scan_count: int
    status: PayoutStatus
    fraud_status: PayoutFraudStatus = "clear"
    paid_at: datetime | None
    notes: str | None
    reviewed_by: UUID | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def derive_fraud_status(cls, value):
        if isinstance(value, dict) and "fraud_status" not in value:
            value = {
                **value,
                "fraud_status": (
                    "flagged" if value.get("status") in {"held", "voided"} else "clear"
                ),
            }
        return value


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


class PayoutSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payout_ids: list[UUID] = Field(min_length=1, max_length=1000)


class PayoutFraudReason(BaseModel):
    code: str
    points: int
    affected_scan_count: int
    evidence: dict


class PosterPayoutContribution(BaseModel):
    qr_code_id: str
    name: str
    poster_template_id: str | None
    scan_count: int
    amount_cents: int


class PayoutReviewEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    from_status: PayoutStatus
    to_status: PayoutStatus
    notes: str | None
    reviewed_by: UUID
    reviewed_at: datetime


class AdminPayoutDetail(BaseModel):
    payout: PosterPayoutResponse
    fraud_reasons: list[PayoutFraudReason]
    contributions: list[PosterPayoutContribution]
    period_start: datetime
    period_end: datetime
    review_history: list[PayoutReviewEvent]


class PayoutCsvExportResponse(BaseModel):
    filename: str
    content: str
