"""Club payouts and ticket sales: the API contract for paid club events."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from core.controlbox import TicketCountry, TicketCurrency

TicketStatus = Literal["valid", "refunded"]
TicketOrderStatus = Literal["pending", "paid", "expired", "failed"]
CheckInResult = Literal[
    "checked_in",
    "already_checked_in",
    "undone",
    "refunded",
    "not_for_this_event",
    "not_found",
]


class ClubPayoutStatus(BaseModel):
    """Whether a club can sell tickets, and what Stripe still needs from it."""

    ticketing_enabled: bool
    connected: bool
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    requirements_due: list[str]
    country: TicketCountry
    currency: TicketCurrency


class ClubEventTicketSummary(BaseModel):
    """One ticketed event on a club's dashboard."""

    event_id: int
    price_cents: int
    currency: TicketCurrency
    capacity: int | None
    sales_paused: bool
    sold: int
    checked_in: int
    revenue_cents: int
    # Holders waiting for the club to refund or decline.
    refund_requests: int


class StripeRedirectResponse(BaseModel):
    """A one-time Stripe URL the browser opens: onboarding or the Express dashboard."""

    url: str


class EventTicketingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price_cents: int = Field(gt=0)
    # Seats per date; None sells without a limit.
    capacity: int | None = Field(default=None, gt=0)
    sales_paused: bool = False


class TicketDateAvailability(BaseModel):
    event_date_id: UUID
    dtstart_utc: datetime
    dtend_utc: datetime | None = None
    # None when the event has no capacity limit.
    remaining: int | None
    sales_open: bool


class EventTicketingResponse(BaseModel):
    """What a ticketed event sells, as anyone viewing the event sees it."""

    event_id: int
    price_cents: int
    currency: TicketCurrency
    capacity: int | None
    sales_paused: bool
    on_sale: bool
    maximum_per_order: int
    dates: list[TicketDateAvailability]


class TicketCheckoutCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_date_id: UUID
    quantity: int = Field(ge=1, le=20)


class TicketCheckoutResponse(BaseModel):
    order_id: UUID
    checkout_url: str


class TicketResponse(BaseModel):
    """One admission as its holder (or a club officer opening its link) sees it."""

    code: str
    status: TicketStatus
    checked_in_at: datetime | None = None
    event_id: int
    event_title: str
    event_date_id: UUID
    dtstart_utc: datetime
    dtend_utc: datetime | None = None
    location: str | None = None
    club_id: int | None = None
    club_name: str | None = None
    school: str | None = None
    image_url: str | None = None
    holder_name: str
    # True when the viewer manages the event's club and can admit this ticket.
    can_check_in: bool = False
    refund_requested_at: datetime | None = None
    refund_declined_at: datetime | None = None
    # True when the viewer bought this ticket and can still ask the club for a refund.
    can_request_refund: bool = False


class TicketOrderResponse(BaseModel):
    """A buyer's own checkout, polled after Stripe sends them back."""

    id: UUID
    status: TicketOrderStatus
    event_id: int
    quantity: int
    unit_amount_cents: int
    currency: TicketCurrency
    tickets: list[TicketResponse]


class TicketAttendee(BaseModel):
    """One ticket on a club's door list."""

    id: UUID
    code: str
    status: TicketStatus
    event_date_id: UUID
    holder_name: str
    holder_email: str
    purchased_at: datetime
    checked_in_at: datetime | None = None
    refunded_at: datetime | None = None
    amount_cents: int
    refund_requested_at: datetime | None = None
    refund_request_note: str | None = None
    refund_declined_at: datetime | None = None


class TicketDateSales(BaseModel):
    event_date_id: UUID
    dtstart_utc: datetime
    sold: int
    checked_in: int
    remaining: int | None


class EventTicketSalesResponse(BaseModel):
    """Everything a club needs at its desk and at the door for one event."""

    ticketing: EventTicketingResponse
    currency: TicketCurrency
    sold: int
    checked_in: int
    refunded: int
    revenue_cents: int
    dates: list[TicketDateSales]
    attendees: list[TicketAttendee]


class TicketCheckInUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checked_in: bool = True


class TicketCheckInResponse(BaseModel):
    result: CheckInResult
    attendee: TicketAttendee | None = None


class TicketRefundsResponse(BaseModel):
    refunded: int


class TicketRefundRequestCreate(BaseModel):
    """A holder asking the club for their money back."""

    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)
