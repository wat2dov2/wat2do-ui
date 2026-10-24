"""Tickets as their holders see them: my tickets, an order after checkout, one ticket by code."""

from uuid import UUID

from fastapi import APIRouter, Depends

from core.auth import AuthUser, get_db_user, get_optional_user, resolve_db_user
from schemas.ticketing import TicketOrderResponse, TicketRefundRequestCreate, TicketResponse
from schemas.user import UserResponse
from services import ticketing_service

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("/mine", response_model=list[TicketResponse])
def list_my_tickets(db_user: UserResponse = Depends(get_db_user)):
    return ticketing_service.my_tickets(db_user)


@router.get("/orders/{order_id}", response_model=TicketOrderResponse)
def get_my_order(order_id: UUID, db_user: UserResponse = Depends(get_db_user)):
    return ticketing_service.order_for_buyer(order_id, db_user)


@router.post("/{code}/refund-request", response_model=TicketResponse)
def request_refund(
    code: str, data: TicketRefundRequestCreate, db_user: UserResponse = Depends(get_db_user)
):
    """The holder asks the club for a refund; its officers get an email."""
    return ticketing_service.request_refund(code, db_user, data.note)


@router.get("/{code}", response_model=TicketResponse)
def get_ticket(code: str, auth_user: AuthUser | None = Depends(get_optional_user)):
    """Anyone holding the code sees the ticket; the club's officers can also admit it."""
    viewer = resolve_db_user(auth_user) if auth_user else None
    return ticketing_service.ticket_by_code(code, viewer)
