"""Ticket sales for one event: settings, checkout, the club's sales desk and the door."""

from uuid import UUID

from fastapi import APIRouter, Depends, status

from core.auth import get_current_user, get_db_user
from core.controlbox import controlbox
from core.rate_limit import RateLimiter
from schemas.ticketing import (
    EventTicketingResponse,
    EventTicketingUpdate,
    EventTicketSalesResponse,
    TicketAttendee,
    TicketCheckInResponse,
    TicketCheckInUpdate,
    TicketCheckoutCreate,
    TicketCheckoutResponse,
    TicketRefundsResponse,
)
from schemas.user import UserResponse
from services import ticketing_service

router = APIRouter(prefix="/events", tags=["ticketing"])

_checkout_limiter = RateLimiter(
    max_requests=controlbox.ticketing.checkout_rate_limit.maximum_requests,
    window_seconds=controlbox.ticketing.checkout_rate_limit.window_seconds,
)


def _buyer_key(user: dict = Depends(get_current_user)) -> str:
    return str(user["id"])


@router.get("/{event_id}/ticketing", response_model=EventTicketingResponse | None)
def get_event_ticketing(event_id: int):
    """Public: what the event sells, or null when it doesn't sell tickets."""
    return ticketing_service.get_event_ticketing(event_id)


@router.put("/{event_id}/ticketing", response_model=EventTicketingResponse)
def configure_event_ticketing(
    event_id: int,
    data: EventTicketingUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    return ticketing_service.configure_ticketing(event_id, data, db_user)


@router.delete("/{event_id}/ticketing", status_code=status.HTTP_204_NO_CONTENT)
def stop_selling_tickets(event_id: int, db_user: UserResponse = Depends(get_db_user)):
    ticketing_service.stop_selling(event_id, db_user)


@router.post(
    "/{event_id}/ticketing/checkout",
    response_model=TicketCheckoutResponse,
    dependencies=[Depends(_checkout_limiter.dependency(key_func=_buyer_key))],
)
def start_ticket_checkout(
    event_id: int,
    data: TicketCheckoutCreate,
    db_user: UserResponse = Depends(get_db_user),
):
    return ticketing_service.start_checkout(event_id, data, db_user)


@router.get("/{event_id}/ticketing/sales", response_model=EventTicketSalesResponse)
def get_ticket_sales(event_id: int, db_user: UserResponse = Depends(get_db_user)):
    return ticketing_service.event_sales(event_id, db_user)


@router.put("/{event_id}/ticketing/check-ins/{code}", response_model=TicketCheckInResponse)
def set_ticket_check_in(
    event_id: int,
    code: str,
    data: TicketCheckInUpdate,
    db_user: UserResponse = Depends(get_db_user),
):
    return ticketing_service.set_check_in(event_id, code, data.checked_in, db_user)


@router.post("/{event_id}/ticketing/tickets/{ticket_id}/refund", response_model=TicketAttendee)
def refund_ticket(event_id: int, ticket_id: UUID, db_user: UserResponse = Depends(get_db_user)):
    return ticketing_service.refund_ticket(event_id, ticket_id, db_user)


@router.post(
    "/{event_id}/ticketing/tickets/{ticket_id}/refund-request/decline",
    response_model=TicketAttendee,
)
def decline_refund_request(
    event_id: int, ticket_id: UUID, db_user: UserResponse = Depends(get_db_user)
):
    """The club keeps the money; the holder gets an email and keeps the ticket."""
    return ticketing_service.decline_refund_request(event_id, ticket_id, db_user)


@router.post("/{event_id}/ticketing/refunds", response_model=TicketRefundsResponse)
def refund_remaining_tickets(event_id: int, db_user: UserResponse = Depends(get_db_user)):
    """Refund every ticket still valid on a cancelled event."""
    return TicketRefundsResponse(
        refunded=ticketing_service.refund_remaining_tickets(event_id, db_user)
    )
