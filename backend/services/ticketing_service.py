"""Selling, issuing, refunding and admitting tickets for club events.

A buyer's seats are held in Postgres while they are on Stripe Checkout, and a
paid checkout becomes tickets exactly once however often Stripe repeats its
webhook. Every charge and refund is a direct charge on the club's own Stripe
account (see ``stripe_gateway``), so Wat2Do never holds ticket money.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import uuid
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError

from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    EVENT_ALREADY_PAST,
    EVENT_HAS_TICKETS,
    EVENT_NOT_FOUND,
    PAYOUTS_NOT_READY,
    TICKET_ALREADY_REFUNDED,
    TICKET_CAPACITY_BELOW_SOLD,
    TICKET_CAPACITY_TOO_HIGH,
    TICKET_DATE_NOT_FOUND,
    TICKET_NOT_FOUND,
    TICKET_ORDER_NOT_FOUND,
    TICKET_PRICE_LOCKED,
    TICKET_PRICE_OUT_OF_RANGE,
    TICKET_QUANTITY_TOO_HIGH,
    TICKET_REFUND_AFTER_CHECK_IN,
    TICKET_REFUND_ALREADY_DECLINED,
    TICKET_REFUND_NOT_REQUESTED,
    TICKET_REFUNDS_NEED_CANCELLATION,
    TICKET_SALES_CLOSED,
    TICKET_SALES_PAUSED,
    TICKETED_DATE_IN_USE,
    TICKETED_EVENT_CANCELLED,
    TICKETED_EVENT_CLUB_LOCKED,
    TICKETING_DISABLED,
    TICKETING_HAS_SALES,
    TICKETING_REQUIRES_CLUB,
    TICKETS_NOT_FOR_SALE,
    TICKETS_SOLD_OUT,
)
from core.exceptions import ConflictError, NotFoundError, ServiceError, ValidationError, get_or_404
from core.pagination import fetch_all_pages
from core.tables import EVENT_TICKETING, TICKET_ORDERS, TICKETS, USERS
from schemas.club import ClubResponse
from schemas.event import EventResponse, EventUpdate
from schemas.event_date import OccurrenceResponse
from schemas.ticketing import (
    CheckInResult,
    ClubEventTicketSummary,
    EventTicketingResponse,
    EventTicketingUpdate,
    EventTicketSalesResponse,
    TicketAttendee,
    TicketCheckInResponse,
    TicketCheckoutCreate,
    TicketCheckoutResponse,
    TicketDateAvailability,
    TicketDateSales,
    TicketOrderResponse,
    TicketResponse,
)
from schemas.user import UserResponse
from services import (
    club_payouts_service,
    club_service,
    event_service,
    going_event_service,
    stripe_gateway,
    ticket_emails,
)
from services.going_event_service import abbreviate_full_name
from services.school_context import school_frontend_url

log = logging.getLogger(__name__)

CONTROL = controlbox.ticketing

_RESERVE_ERRORS = {
    "TICKETS_NOT_FOR_SALE": TICKETS_NOT_FOR_SALE,
    "TICKET_SALES_PAUSED": TICKET_SALES_PAUSED,
    "EVENT_CANCELLED": TICKETED_EVENT_CANCELLED,
    "TICKET_DATE_NOT_FOUND": TICKET_DATE_NOT_FOUND,
    "TICKET_SALES_CLOSED": TICKET_SALES_CLOSED,
    "PAYOUTS_NOT_READY": PAYOUTS_NOT_READY,
    "TICKETS_SOLD_OUT": TICKETS_SOLD_OUT,
}
# 15 random bytes are 24 base32 characters: unguessable, and easy to type by hand.
_CODE_BYTES = 15
_ORDER_WITH_TICKETS = "*, tickets(*)"
_TICKET_WITH_ORDER = "*, ticket_orders(*)"
# Stripe measures a session's 30-minute minimum from its own clock, after this request.
_STRIPE_EXPIRY_MARGIN = timedelta(minutes=1)
# Orders that no longer hold anything and can be cleared when a date or event goes away.
_STALE_ORDER_STATUSES = ("expired", "failed")


def new_ticket_code() -> str:
    return base64.b32encode(secrets.token_bytes(_CODE_BYTES)).decode().rstrip("=")


def normalize_ticket_code(value: str) -> str:
    """The stored form of a code read from a QR link or typed at the door."""
    code = value.strip().rstrip("/").rsplit("/", 1)[-1]
    return code.replace(" ", "").replace("-", "").upper()


# --------------------------------------------------------------------------
# What an event sells
# --------------------------------------------------------------------------


def managed_event(event_id: int, manager: UserResponse) -> EventResponse:
    """The event, when *manager* runs the club hosting it (or is an admin)."""
    event = get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)
    club_service.get_managed_club(_club_id(event), manager)
    return event


def _club_id(event: EventResponse) -> int:
    if event.club_id is None:
        raise ValidationError(TICKETING_REQUIRES_CLUB)
    return event.club_id


def get_event_ticketing(event_id: int) -> EventTicketingResponse | None:
    """What the event sells right now, or None when it doesn't sell tickets."""
    event = get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)
    row = _ticketing_row(event_id)
    return _ticketing_view(event, row, _now()) if row is not None else None


def configure_ticketing(
    event_id: int, data: EventTicketingUpdate, manager: UserResponse
) -> EventTicketingResponse:
    _require_enabled()
    event = managed_event(event_id, manager)
    if event.cancelled:
        raise ValidationError(TICKETED_EVENT_CANCELLED)
    if event_service.has_ended(event):
        raise ValidationError(EVENT_ALREADY_PAST)
    account = club_payouts_service.require_charges_enabled(_club_id(event))
    if not CONTROL.minimum_price_cents <= data.price_cents <= CONTROL.maximum_price_cents:
        raise ValidationError(TICKET_PRICE_OUT_OF_RANGE)
    if data.capacity is not None and data.capacity > CONTROL.maximum_capacity:
        raise ValidationError(TICKET_CAPACITY_TOO_HIGH)

    existing = _ticketing_row(event_id)
    sold_by_date = _valid_tickets_by_date(event_id)
    if (
        existing is not None
        and existing["price_cents"] != data.price_cents
        and _has_paid_orders(event_id)
    ):
        raise ConflictError(TICKET_PRICE_LOCKED)
    if data.capacity is not None and max(sold_by_date.values(), default=0) > data.capacity:
        raise ConflictError(TICKET_CAPACITY_BELOW_SOLD)

    get_sb().table(EVENT_TICKETING).upsert(
        {
            "event_id": event_id,
            "price_cents": data.price_cents,
            # A Stripe account settles in one currency; the first ticket price fixes it.
            "currency": (
                existing["currency"]
                if existing is not None
                else CONTROL.currency_by_country[account["country"]]
            ),
            "capacity": data.capacity,
            "sales_paused": data.sales_paused,
            "updated_by": str(manager.id),
        },
        on_conflict="event_id",
    ).execute()
    # The event's own price and registration flag mirror the ticket, so cards,
    # filters and search show the same price buyers pay.
    event_service.update_event(
        event_id, EventUpdate(price=data.price_cents / 100, registration=True)
    )
    return _ticketing_view(
        event, get_or_404(_ticketing_row(event_id), TICKETS_NOT_FOR_SALE), _now()
    )


def stop_selling(event_id: int, manager: UserResponse) -> None:
    """Remove ticketing from an event that never sold a ticket."""
    event = managed_event(event_id, manager)
    if _has_paid_orders(event_id) or _has_live_holds(event_id, _now()):
        raise ConflictError(TICKETING_HAS_SALES)
    _clear_stale_orders(event_id)
    get_sb().table(EVENT_TICKETING).delete().eq("event_id", event_id).execute()
    if not event_service.has_ended(event):
        event_service.update_event(event_id, EventUpdate(registration=False))


def ensure_event_deletable(event_id: int) -> None:
    """Refuse to delete an event people paid for; it must be cancelled instead."""
    if _has_paid_orders(event_id) or _has_live_holds(event_id, _now()):
        raise ConflictError(EVENT_HAS_TICKETS)
    _clear_stale_orders(event_id)


def ensure_edit_keeps_tickets(event: EventResponse, data: EventUpdate) -> None:
    """An edit may change a ticketed event's details, but never strand its tickets."""
    if _ticketing_row(event.id) is None:
        return
    if data.club_id is not None and data.club_id != event.club_id:
        raise ConflictError(TICKETED_EVENT_CLUB_LOCKED)
    if data.occurrences is not None:
        ensure_dates_removable(
            event.id, [item.id for item in data.occurrences if item.id is not None]
        )


def ensure_dates_removable(event_id: int, kept_date_ids: Iterable[UUID]) -> None:
    """Refuse to drop a date that has tickets or a buyer mid-checkout."""
    kept = {str(date_id) for date_id in kept_date_ids}
    orders = _orders_for_event(event_id, select="id,event_date_id,status,reserved_until")
    now = _now()
    for order in orders:
        if order["event_date_id"] in kept:
            continue
        if order["status"] == "paid" or _is_live_hold(order, now):
            raise ConflictError(TICKETED_DATE_IN_USE)
    _clear_stale_orders(event_id, keep_dates=kept)


# --------------------------------------------------------------------------
# Buying
# --------------------------------------------------------------------------


def start_checkout(
    event_id: int, data: TicketCheckoutCreate, buyer: UserResponse
) -> TicketCheckoutResponse:
    """Hold the seats, then send the buyer to Stripe Checkout on the club's account."""
    _require_enabled()
    if data.quantity > CONTROL.maximum_tickets_per_order:
        raise ValidationError(TICKET_QUANTITY_TOO_HIGH)
    event = get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)
    occurrence = next((item for item in event.occurrences if item.id == data.event_date_id), None)
    if occurrence is None:
        raise ValidationError(TICKET_DATE_NOT_FOUND)

    now = _now()
    checkout_ends = now + timedelta(minutes=CONTROL.checkout_minutes) + _STRIPE_EXPIRY_MARGIN
    order = _reserve(
        uuid.uuid4(),
        event_id,
        data,
        buyer,
        reserved_until=checkout_ends + timedelta(minutes=CONTROL.reservation_grace_minutes),
        now=now,
    )
    club = club_service.get_club(int(order["club_id"]))
    try:
        session = stripe_gateway.create_checkout_session(
            order["stripe_account_id"],
            _checkout_params(event, occurrence, club, order, buyer, expires_at=checkout_ends),
            idempotency_key=f"ticket-checkout-{order['id']}",
        )
    except ServiceError:
        # Release the seats at once instead of holding them for a checkout that never opened.
        _set_order_status(order["id"], "failed", only_from="pending")
        raise
    get_sb().table(TICKET_ORDERS).update({"stripe_checkout_session_id": session.id}).eq(
        "id", order["id"]
    ).execute()
    return TicketCheckoutResponse(order_id=UUID(order["id"]), checkout_url=session.url)


def handle_stripe_event(event: stripe_gateway.StripeEvent) -> Callable[[], None] | None:
    """Apply one Connect webhook event; returns work to run after Stripe is answered."""
    session = event.object
    if event.type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        order_id = _known_order_id(session)
        if session.get("payment_status") != "paid" or order_id is None:
            return None
        if fulfil_order(order_id, str(session["id"]), session.get("payment_intent")):
            return lambda: _after_fulfilment(order_id)
        return None
    if event.type in ("checkout.session.expired", "checkout.session.async_payment_failed"):
        expired_id = _known_order_id(session)
        if expired_id is not None:
            _set_order_status(str(expired_id), "expired", only_from="pending")
        return None
    if event.type == "account.updated":
        club_payouts_service.sync_account(stripe_gateway.connected_account(session))
    return None


def _known_order_id(session: dict[str, Any]) -> UUID | None:
    """The order a Checkout session belongs to, if Wat2Do created it."""
    try:
        order_id = UUID(str(session.get("client_reference_id")))
    except ValueError:
        log.warning("Stripe session %s has no Wat2Do order", session.get("id"))
        return None
    if _order(order_id, select="id") is None:
        log.warning("Stripe session %s names unknown order %s", session.get("id"), order_id)
        return None
    return order_id


def fulfil_order(order_id: UUID, checkout_session_id: str, payment_intent_id: str | None) -> bool:
    """Issue the order's tickets; True only for the delivery that issued them."""
    order = get_or_404(_order(order_id), TICKET_ORDER_NOT_FOUND)
    codes = [new_ticket_code() for _ in range(int(order["quantity"]))]
    response = (
        get_sb()
        .rpc(
            "fulfil_ticket_order",
            {
                "p_order_id": str(order_id),
                "p_checkout_session_id": checkout_session_id,
                "p_payment_intent_id": payment_intent_id,
                "p_codes": codes,
                "p_now": _now().isoformat(),
            },
        )
        .execute()
    )
    return response.data is True


# --------------------------------------------------------------------------
# Refunds
# --------------------------------------------------------------------------


def refund_ticket(event_id: int, ticket_id: UUID, manager: UserResponse) -> TicketAttendee:
    event = managed_event(event_id, manager)
    ticket = _ticket(ticket_id)
    if ticket is None or int(ticket["event_id"]) != event_id:
        raise NotFoundError(TICKET_NOT_FOUND)
    if ticket["status"] == "refunded":
        raise ConflictError(TICKET_ALREADY_REFUNDED)
    order = ticket["ticket_orders"]
    _refund(order, [ticket], refunded_by=str(manager.id), key=f"ticket-refund-{ticket_id}")
    ticket_emails.send_refund_notice(
        order=order,
        count=1,
        amount_cents=int(order["unit_amount_cents"]),
        event=event,
        club_name=_club_name(event.club_id),
        reason="refunded",
    )
    return _attendee(get_or_404(_ticket(ticket_id), TICKET_NOT_FOUND), _holder_names([order]))


def request_refund(code: str, buyer: UserResponse, note: str | None) -> TicketResponse:
    """The holder asks the club for their money back, and every officer hears about it.

    Asking again changes nothing and emails nobody twice.
    """
    ticket = _ticket_by_code(normalize_ticket_code(code))
    if ticket is None or str(ticket["ticket_orders"]["buyer_user_id"]) != str(buyer.id):
        raise NotFoundError(TICKET_NOT_FOUND)
    if ticket["status"] == "refunded":
        raise ConflictError(TICKET_ALREADY_REFUNDED)
    if ticket.get("checked_in_at"):
        raise ConflictError(TICKET_REFUND_AFTER_CHECK_IN)
    if ticket.get("refund_declined_at"):
        raise ConflictError(TICKET_REFUND_ALREADY_DECLINED)
    event = get_or_404(event_service.get_event(int(ticket["event_id"])), TICKET_NOT_FOUND)
    order = ticket["ticket_orders"]
    names = _holder_names([order])
    if not ticket.get("refund_requested_at"):
        claimed = (
            get_sb()
            .table(TICKETS)
            .update(
                {
                    "refund_requested_at": _now().isoformat(),
                    "refund_request_note": (note or "").strip() or None,
                }
            )
            .eq("id", ticket["id"])
            .eq("status", "valid")
            .is_("refund_requested_at", "null")
            .execute()
        ).data
        if claimed:
            ticket = {**ticket, **claimed[0], "ticket_orders": order}
            ticket_emails.send_refund_request(
                ticket=ticket,
                order=order,
                holder_name=names.get(str(buyer.id), buyer.email),
                event=event,
                club_name=_club_name(event.club_id),
                recipients=_officer_emails(event.club_id),
            )
        else:
            ticket = get_or_404(_ticket(ticket["id"]), TICKET_NOT_FOUND)
    return _ticket_response(ticket, event, names, can_check_in=_manages(event, buyer), viewer=buyer)


def decline_refund_request(event_id: int, ticket_id: UUID, manager: UserResponse) -> TicketAttendee:
    """The club says no; the holder hears about it and keeps their ticket."""
    event = managed_event(event_id, manager)
    ticket = _ticket(ticket_id)
    if ticket is None or int(ticket["event_id"]) != event_id:
        raise NotFoundError(TICKET_NOT_FOUND)
    if ticket["status"] == "refunded":
        raise ConflictError(TICKET_ALREADY_REFUNDED)
    if not ticket.get("refund_requested_at"):
        raise ConflictError(TICKET_REFUND_NOT_REQUESTED)
    order = ticket["ticket_orders"]
    if not ticket.get("refund_declined_at"):
        declined = (
            get_sb()
            .table(TICKETS)
            .update({"refund_declined_at": _now().isoformat()})
            .eq("id", str(ticket_id))
            .is_("refund_declined_at", "null")
            .execute()
        ).data
        if declined:
            ticket_emails.send_refund_declined(
                ticket=ticket, order=order, event=event, club_name=_club_name(event.club_id)
            )
    return _attendee(get_or_404(_ticket(ticket_id), TICKET_NOT_FOUND), _holder_names([order]))


def refund_remaining_tickets(event_id: int, manager: UserResponse) -> int:
    """Finish refunding a cancelled event, e.g. after Stripe was briefly unreachable."""
    event = managed_event(event_id, manager)
    if not event.cancelled:
        raise ValidationError(TICKET_REFUNDS_NEED_CANCELLATION)
    return refund_cancelled_event(event_id, refunded_by=str(manager.id))


def refund_cancelled_event(event_id: int, *, refunded_by: str | None) -> int:
    """Refund every valid ticket of a cancelled event, one refund per order.

    Each order is attempted on its own, so one failure never blocks the rest;
    calling again finishes whatever is left. Returns the tickets refunded.
    """
    event = get_or_404(event_service.get_event(event_id), EVENT_NOT_FOUND)
    refunded = 0
    club_name = _club_name(event.club_id)
    for order in _orders_for_event(event_id, select=_ORDER_WITH_TICKETS, status="paid"):
        valid = [ticket for ticket in order.get("tickets") or [] if ticket["status"] == "valid"]
        if not valid:
            continue
        ids = ",".join(sorted(ticket["id"] for ticket in valid))
        key = f"order-refund-{order['id']}-{hashlib.sha256(ids.encode()).hexdigest()[:16]}"
        try:
            _refund(order, valid, refunded_by=refunded_by, key=key)
        except ServiceError:
            log.error("Could not refund order %s of cancelled event %s", order["id"], event_id)
            continue
        refunded += len(valid)
        ticket_emails.send_refund_notice(
            order=order,
            count=len(valid),
            amount_cents=int(order["unit_amount_cents"]) * len(valid),
            event=event,
            club_name=club_name,
            reason="cancelled",
        )
    return refunded


# --------------------------------------------------------------------------
# The door
# --------------------------------------------------------------------------


def set_check_in(
    event_id: int, code: str, checked_in: bool, manager: UserResponse
) -> TicketCheckInResponse:
    managed_event(event_id, manager)
    ticket = _ticket_by_code(normalize_ticket_code(code))
    if ticket is None:
        return TicketCheckInResponse(result="not_found")
    if int(ticket["event_id"]) != event_id:
        return TicketCheckInResponse(result="not_for_this_event")
    names = _holder_names([ticket["ticket_orders"]])
    if ticket["status"] == "refunded":
        return TicketCheckInResponse(result="refunded", attendee=_attendee(ticket, names))

    result: CheckInResult
    query = get_sb().table(TICKETS)
    if checked_in:
        updated = (
            query.update({"checked_in_at": _now().isoformat(), "checked_in_by": str(manager.id)})
            .eq("id", ticket["id"])
            .is_("checked_in_at", "null")
            .execute()
        ).data
        result = "checked_in" if updated else "already_checked_in"
    else:
        query.update({"checked_in_at": None, "checked_in_by": None}).eq(
            "id", ticket["id"]
        ).execute()
        result = "undone"
    return TicketCheckInResponse(
        result=result,
        attendee=_attendee(get_or_404(_ticket(ticket["id"]), TICKET_NOT_FOUND), names),
    )


def event_sales(event_id: int, manager: UserResponse) -> EventTicketSalesResponse:
    """Totals, per-date counts and the full door list for one ticketed event."""
    event = managed_event(event_id, manager)
    row = get_or_404(_ticketing_row(event_id), TICKETS_NOT_FOR_SALE)
    now = _now()
    tickets = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(TICKETS)
                .select(_TICKET_WITH_ORDER)
                .eq("event_id", event_id)
                .order("created_at", desc=False)
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        )
    )
    names = _holder_names([ticket["ticket_orders"] for ticket in tickets])
    attendees = [_attendee(ticket, names) for ticket in tickets]
    valid = [ticket for ticket in attendees if ticket.status == "valid"]
    sold = Counter(str(ticket.event_date_id) for ticket in valid)
    admitted = Counter(str(ticket.event_date_id) for ticket in valid if ticket.checked_in_at)
    view = _ticketing_view(event, row, now)
    remaining = {str(item.event_date_id): item.remaining for item in view.dates}
    return EventTicketSalesResponse(
        ticketing=view,
        currency=row["currency"],
        sold=len(valid),
        checked_in=sum(admitted.values()),
        refunded=len(attendees) - len(valid),
        revenue_cents=sum(ticket.amount_cents for ticket in valid),
        dates=[
            TicketDateSales(
                event_date_id=occurrence.id,
                dtstart_utc=occurrence.dtstart_utc,
                sold=sold[str(occurrence.id)],
                checked_in=admitted[str(occurrence.id)],
                remaining=remaining.get(str(occurrence.id)),
            )
            for occurrence in event.occurrences
        ],
        attendees=attendees,
    )


def club_ticket_summaries(club: ClubResponse) -> list[ClubEventTicketSummary]:
    """Sales at a glance for every ticketed event of a club, for its dashboard."""
    rows = (
        get_sb()
        .table(EVENT_TICKETING)
        .select("*, events!inner(club_id)")
        .eq("events.club_id", club.id)
        .execute()
    ).data or []
    if not rows:
        return []
    tickets = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(TICKETS)
                .select(
                    "event_id,checked_in_at,refund_requested_at,refund_declined_at,"
                    "ticket_orders(unit_amount_cents)"
                )
                .in_("event_id", [row["event_id"] for row in rows])
                .eq("status", "valid")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        )
    )
    sold = Counter(int(ticket["event_id"]) for ticket in tickets)
    admitted = Counter(int(ticket["event_id"]) for ticket in tickets if ticket["checked_in_at"])
    waiting = Counter(int(ticket["event_id"]) for ticket in tickets if _refund_waiting(ticket))
    revenue: Counter[int] = Counter()
    for ticket in tickets:
        revenue[int(ticket["event_id"])] += int(ticket["ticket_orders"]["unit_amount_cents"])
    return [
        ClubEventTicketSummary(
            event_id=int(row["event_id"]),
            price_cents=int(row["price_cents"]),
            currency=row["currency"],
            capacity=row["capacity"],
            sales_paused=bool(row["sales_paused"]),
            sold=sold[int(row["event_id"])],
            checked_in=admitted[int(row["event_id"])],
            revenue_cents=revenue[int(row["event_id"])],
            refund_requests=waiting[int(row["event_id"])],
        )
        for row in rows
    ]


def ticket_buyer_ids(event_id: int) -> set[str]:
    """Everyone who bought tickets to an event, kept off its public who's-going list."""
    rows = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(TICKET_ORDERS)
                .select("buyer_user_id")
                .eq("event_id", event_id)
                .eq("status", "paid")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        )
    )
    return {str(row["buyer_user_id"]) for row in rows}


def refund_request_links(event: EventResponse, user_ids: Iterable[str]) -> dict[str, str]:
    """Where each holder of a still-usable ticket can ask for a refund after the event changed.

    One ticket opens its page with the request ready; several open My tickets.
    """
    wanted = set(user_ids)
    if not wanted:
        return {}
    tickets = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(TICKETS)
                .select(_TICKET_WITH_ORDER)
                .eq("event_id", event.id)
                .eq("status", "valid")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        )
    )
    codes: dict[str, list[str]] = {}
    for ticket in tickets:
        holder = str(ticket["ticket_orders"]["buyer_user_id"])
        if holder in wanted and _refund_requestable(ticket):
            codes.setdefault(holder, []).append(ticket["code"])
    frontend = school_frontend_url(event.school)
    return {
        holder: f"{frontend}/tickets/{held[0]}?refund=1"
        if len(held) == 1
        else f"{frontend}/tickets"
        for holder, held in codes.items()
    }


# --------------------------------------------------------------------------
# Tickets as their holders see them
# --------------------------------------------------------------------------


def ticket_by_code(code: str, viewer: UserResponse | None) -> TicketResponse:
    ticket = get_or_404(_ticket_by_code(normalize_ticket_code(code)), TICKET_NOT_FOUND)
    event = get_or_404(event_service.get_event(int(ticket["event_id"])), TICKET_NOT_FOUND)
    names = _holder_names([ticket["ticket_orders"]])
    return _ticket_response(
        ticket, event, names, can_check_in=_manages(event, viewer), viewer=viewer
    )


def my_tickets(holder: UserResponse) -> list[TicketResponse]:
    """Every ticket the user bought, soonest date first."""
    orders = (
        get_sb()
        .table(TICKET_ORDERS)
        .select(_ORDER_WITH_TICKETS)
        .eq("buyer_user_id", str(holder.id))
        .eq("status", "paid")
        .execute()
    ).data or []
    names = _holder_names(orders)
    events = _events_by_id(int(order["event_id"]) for order in orders)
    tickets = [
        _ticket_response(
            {**ticket, "ticket_orders": order},
            events[int(order["event_id"])],
            names,
            viewer=holder,
        )
        for order in orders
        if int(order["event_id"]) in events
        for ticket in order.get("tickets") or []
    ]
    return sorted(tickets, key=lambda ticket: ticket.dtstart_utc)


def order_for_buyer(order_id: UUID, buyer: UserResponse) -> TicketOrderResponse:
    """The buyer's own order, polled by the page Stripe returns them to."""
    order = _order(order_id, select=_ORDER_WITH_TICKETS)
    if order is None or order["buyer_user_id"] != str(buyer.id):
        raise NotFoundError(TICKET_ORDER_NOT_FOUND)
    event = get_or_404(event_service.get_event(int(order["event_id"])), TICKET_ORDER_NOT_FOUND)
    names = _holder_names([order])
    return TicketOrderResponse(
        id=UUID(order["id"]),
        status=order["status"],
        event_id=int(order["event_id"]),
        quantity=int(order["quantity"]),
        unit_amount_cents=int(order["unit_amount_cents"]),
        currency=order["currency"],
        tickets=[
            _ticket_response({**ticket, "ticket_orders": order}, event, names, viewer=buyer)
            for ticket in order.get("tickets") or []
        ],
    )


# --------------------------------------------------------------------------
# Internals
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_enabled() -> None:
    if not CONTROL.enabled:
        raise ValidationError(TICKETING_DISABLED)


def _ticketing_row(event_id: int) -> dict[str, Any] | None:
    response = (
        get_sb().table(EVENT_TICKETING).select("*").eq("event_id", event_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def _ticketing_view(
    event: EventResponse, row: dict[str, Any], now: datetime
) -> EventTicketingResponse:
    taken = _seats_taken(event.id, now)
    capacity = row["capacity"]
    dates = []
    for occurrence in event.occurrences:
        remaining = (
            None if capacity is None else max(int(capacity) - taken.get(str(occurrence.id), 0), 0)
        )
        dates.append(
            TicketDateAvailability(
                event_date_id=occurrence.id,
                dtstart_utc=occurrence.dtstart_utc,
                dtend_utc=occurrence.dtend_utc,
                remaining=remaining,
                sales_open=occurrence.dtstart_utc > now and remaining != 0,
            )
        )
    account = club_payouts_service.get_payment_account(event.club_id) if event.club_id else None
    on_sale = (
        CONTROL.enabled
        and not row["sales_paused"]
        and not event.cancelled
        and bool(account and account["charges_enabled"])
        and any(item.sales_open for item in dates)
    )
    return EventTicketingResponse(
        event_id=event.id,
        price_cents=int(row["price_cents"]),
        currency=row["currency"],
        capacity=capacity,
        sales_paused=bool(row["sales_paused"]),
        on_sale=on_sale,
        maximum_per_order=CONTROL.maximum_tickets_per_order,
        dates=dates,
    )


def _seats_taken(event_id: int, now: datetime) -> dict[str, int]:
    response = (
        get_sb()
        .rpc("event_ticket_seats_taken", {"p_event_id": event_id, "p_now": now.isoformat()})
        .execute()
    )
    return {str(row["event_date_id"]): int(row["seats_taken"]) for row in response.data or []}


def _reserve(
    order_id: UUID,
    event_id: int,
    data: TicketCheckoutCreate,
    buyer: UserResponse,
    *,
    reserved_until: datetime,
    now: datetime,
) -> dict[str, Any]:
    try:
        response = (
            get_sb()
            .rpc(
                "reserve_ticket_order",
                {
                    "p_order_id": str(order_id),
                    "p_event_id": event_id,
                    "p_event_date_id": str(data.event_date_id),
                    "p_buyer_user_id": str(buyer.id),
                    "p_buyer_email": buyer.email,
                    "p_quantity": data.quantity,
                    "p_reserved_until": reserved_until.isoformat(),
                    "p_now": now.isoformat(),
                },
            )
            .execute()
        )
    except APIError as exc:
        detail = _RESERVE_ERRORS.get(exc.message or "")
        if detail is not None:
            raise ValidationError(detail) from exc
        raise
    if not response.data:
        raise RuntimeError("Ticket reservation returned no order")
    return dict(response.data[0])


def _checkout_params(
    event: EventResponse,
    occurrence: OccurrenceResponse,
    club: ClubResponse | None,
    order: dict[str, Any],
    buyer: UserResponse,
    *,
    expires_at: datetime,
) -> dict[str, Any]:
    frontend = school_frontend_url(event.school)
    when = ticket_emails.occurrence_label(event, occurrence)
    metadata = {
        "order_id": order["id"],
        "event_id": str(event.id),
        "event_date_id": str(occurrence.id),
    }
    product: dict[str, Any] = {
        "name": event.title[:250],
        "description": f"{when} · {event.location}"[:500] if event.location else when,
    }
    if event.source_image_url and event.source_image_url.startswith("https://"):
        product["images"] = [event.source_image_url]
    branding: dict[str, Any] = {"display_name": (club.club_name if club else event.club)[:100]}
    if club and club.logo_url and club.logo_url.startswith("https://"):
        branding["logo"] = {"type": "url", "url": club.logo_url}
    return {
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": [
            {
                "quantity": int(order["quantity"]),
                "price_data": {
                    "currency": order["currency"],
                    "unit_amount": int(order["unit_amount_cents"]),
                    "product_data": product,
                },
            }
        ],
        "customer_email": buyer.email,
        "client_reference_id": order["id"],
        "metadata": metadata,
        "payment_intent_data": {
            "description": f"{order['quantity']} × {event.title}"[:1000],
            "metadata": metadata,
        },
        "expires_at": int(expires_at.timestamp()),
        "success_url": f"{frontend}/tickets/orders/{order['id']}",
        "cancel_url": f"{frontend}/events/{event.id}",
        "submit_type": "pay",
        "custom_text": {"submit": {"message": "Your tickets arrive by email right after you pay."}},
        "branding_settings": branding,
    }


def _after_fulfilment(order_id: UUID) -> None:
    """Mark the buyer going and send the receipt, once, after Stripe is answered."""
    claimed = (
        get_sb()
        .table(TICKET_ORDERS)
        .update({"confirmation_sent_at": _now().isoformat()})
        .eq("id", str(order_id))
        .is_("confirmation_sent_at", "null")
        .execute()
    ).data
    if not claimed:
        return
    order = get_or_404(_order(order_id, select=_ORDER_WITH_TICKETS), TICKET_ORDER_NOT_FOUND)
    event = event_service.get_event(int(order["event_id"]))
    if event is None:
        log.error("Paid order %s has no event to confirm", order_id)
        return
    occurrence = next(
        (item for item in event.occurrences if str(item.id) == order["event_date_id"]), None
    )
    _mark_going(order)
    if occurrence is None:
        log.error("Paid order %s has no date to confirm", order_id)
        return
    ticket_emails.send_confirmation(
        order=order,
        codes=[ticket["code"] for ticket in order.get("tickets") or []],
        event=event,
        occurrence=occurrence,
        club_name=_club_name(event.club_id),
    )


def _mark_going(order: dict[str, Any]) -> None:
    """A ticket holder is going, so reminders and change alerts reach them too."""
    user_id = str(order["buyer_user_id"])
    event_id = int(order["event_id"])
    selected = next(
        (
            selection.occurrence_ids
            for selection in going_event_service.get_going_event_selections(user_id)
            if selection.event_id == event_id
        ),
        [],
    )
    date_id = UUID(str(order["event_date_id"]))
    if date_id in selected:
        return
    try:
        going_event_service.set_going_occurrences(user_id, event_id, [*selected, date_id])
    except ServiceError as exc:
        log.info("Ticket holder %s not marked going: %s", user_id, exc.detail)


def _refund(
    order: dict[str, Any], tickets: list[dict[str, Any]], *, refunded_by: str | None, key: str
) -> None:
    refund_id = stripe_gateway.refund(
        order["stripe_account_id"],
        payment_intent_id=str(order["stripe_payment_intent_id"]),
        amount_cents=int(order["unit_amount_cents"]) * len(tickets),
        idempotency_key=key,
        metadata={"order_id": str(order["id"]), "event_id": str(order["event_id"])},
    )
    get_sb().table(TICKETS).update(
        {
            "status": "refunded",
            "refunded_at": _now().isoformat(),
            "refunded_by": refunded_by,
            "stripe_refund_id": refund_id,
        }
    ).in_("id", [ticket["id"] for ticket in tickets]).eq("status", "valid").execute()


def _order(order_id: UUID | str, *, select: str = "*") -> dict[str, Any] | None:
    response = get_sb().table(TICKET_ORDERS).select(select).eq("id", str(order_id)).execute()
    return response.data[0] if response.data else None


def _orders_for_event(
    event_id: int, *, select: str, status: str | None = None
) -> list[dict[str, Any]]:
    def page(offset: int, size: int) -> list[dict[str, Any]]:
        query = get_sb().table(TICKET_ORDERS).select(select).eq("event_id", event_id)
        if status is not None:
            query = query.eq("status", status)
        return query.order("created_at").range(offset, offset + size - 1).execute().data or []

    return fetch_all_pages(page)


def _set_order_status(order_id: str, status: str, *, only_from: str) -> None:
    get_sb().table(TICKET_ORDERS).update({"status": status}).eq("id", order_id).eq(
        "status", only_from
    ).execute()


def _has_paid_orders(event_id: int) -> bool:
    response = (
        get_sb()
        .table(TICKET_ORDERS)
        .select("id")
        .eq("event_id", event_id)
        .eq("status", "paid")
        .limit(1)
        .execute()
    )
    return bool(response.data)


def _has_live_holds(event_id: int, now: datetime) -> bool:
    response = (
        get_sb()
        .table(TICKET_ORDERS)
        .select("id")
        .eq("event_id", event_id)
        .eq("status", "pending")
        .gt("reserved_until", now.isoformat())
        .limit(1)
        .execute()
    )
    return bool(response.data)


def _is_live_hold(order: dict[str, Any], now: datetime) -> bool:
    return order["status"] == "pending" and datetime.fromisoformat(order["reserved_until"]) > now


def _clear_stale_orders(event_id: int, *, keep_dates: set[str] | None = None) -> None:
    """Delete finished holds so a removed date or event is not pinned by them."""
    query = (
        get_sb()
        .table(TICKET_ORDERS)
        .delete()
        .eq("event_id", event_id)
        .in_("status", list(_STALE_ORDER_STATUSES))
    )
    if keep_dates:
        query = query.not_.in_("event_date_id", sorted(keep_dates))
    query.execute()


def _valid_tickets_by_date(event_id: int) -> dict[str, int]:
    rows = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(TICKETS)
                .select("event_date_id")
                .eq("event_id", event_id)
                .eq("status", "valid")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        )
    )
    return dict(Counter(str(row["event_date_id"]) for row in rows))


def _ticket(ticket_id: UUID | str) -> dict[str, Any] | None:
    response = get_sb().table(TICKETS).select(_TICKET_WITH_ORDER).eq("id", str(ticket_id)).execute()
    return response.data[0] if response.data else None


def _ticket_by_code(code: str) -> dict[str, Any] | None:
    response = get_sb().table(TICKETS).select(_TICKET_WITH_ORDER).eq("code", code).execute()
    return response.data[0] if response.data else None


def _holder_names(orders: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Display names keyed by buyer id: their profile name, or their email's name."""
    buyers = {str(order["buyer_user_id"]): order["buyer_email"] for order in orders}
    if not buyers:
        return {}
    rows = (
        get_sb().table(USERS).select("id,full_name").in_("id", sorted(buyers)).execute()
    ).data or []
    full_names = {str(row["id"]): row.get("full_name") for row in rows}
    return {
        buyer_id: full_names.get(buyer_id) or email.split("@", 1)[0]
        for buyer_id, email in buyers.items()
    }


def _attendee(ticket: dict[str, Any], names: dict[str, str]) -> TicketAttendee:
    order = ticket["ticket_orders"]
    return TicketAttendee(
        id=ticket["id"],
        code=ticket["code"],
        status=ticket["status"],
        event_date_id=ticket["event_date_id"],
        holder_name=names.get(str(order["buyer_user_id"]), order["buyer_email"]),
        holder_email=order["buyer_email"],
        purchased_at=order.get("paid_at") or ticket["created_at"],
        checked_in_at=ticket.get("checked_in_at"),
        refunded_at=ticket.get("refunded_at"),
        amount_cents=int(order["unit_amount_cents"]),
        refund_requested_at=ticket.get("refund_requested_at"),
        refund_request_note=ticket.get("refund_request_note"),
        refund_declined_at=ticket.get("refund_declined_at"),
    )


def _ticket_response(
    ticket: dict[str, Any],
    event: EventResponse,
    names: dict[str, str],
    *,
    can_check_in: bool = False,
    viewer: UserResponse | None = None,
) -> TicketResponse:
    order = ticket["ticket_orders"]
    occurrence = next(
        (item for item in event.occurrences if str(item.id) == str(ticket["event_date_id"])),
        None,
    )
    holder = names.get(str(order["buyer_user_id"]), "")
    return TicketResponse(
        code=ticket["code"],
        status=ticket["status"],
        checked_in_at=ticket.get("checked_in_at"),
        event_id=event.id,
        event_title=event.title,
        event_date_id=ticket["event_date_id"],
        dtstart_utc=occurrence.dtstart_utc if occurrence else event.occurrences[0].dtstart_utc,
        dtend_utc=occurrence.dtend_utc if occurrence else None,
        location=event.location,
        club_id=event.club_id,
        club_name=event.club,
        school=event.school,
        image_url=event.source_image_url,
        holder_name=abbreviate_full_name(holder) or holder,
        can_check_in=can_check_in,
        refund_requested_at=ticket.get("refund_requested_at"),
        refund_declined_at=ticket.get("refund_declined_at"),
        can_request_refund=viewer is not None
        and str(order["buyer_user_id"]) == str(viewer.id)
        and _refund_requestable(ticket),
    )


def _events_by_id(event_ids: Iterable[int]) -> dict[int, EventResponse]:
    events = {}
    for event_id in set(event_ids):
        event = event_service.get_event(event_id)
        if event is not None:
            events[event_id] = event
    return events


def _refund_requestable(ticket: dict[str, Any]) -> bool:
    """A holder can ask once, for a valid ticket nobody has used at the door."""
    return (
        ticket["status"] == "valid"
        and not ticket.get("checked_in_at")
        and not ticket.get("refund_requested_at")
        and not ticket.get("refund_declined_at")
    )


def _refund_waiting(ticket: dict[str, Any]) -> bool:
    return bool(ticket.get("refund_requested_at")) and not ticket.get("refund_declined_at")


def _officer_emails(club_id: int | None) -> list[str]:
    if club_id is None:
        return []
    return sorted({member.email for member in club_service.list_club_members(club_id)})


def _manages(event: EventResponse, viewer: UserResponse | None) -> bool:
    if viewer is None or event.club_id is None:
        return False
    try:
        club_service.get_managed_club(event.club_id, viewer)
    except ServiceError:
        return False
    return True


def _club_name(club_id: int | None) -> str | None:
    club = club_service.get_club(club_id) if club_id is not None else None
    return club.club_name if club else None
