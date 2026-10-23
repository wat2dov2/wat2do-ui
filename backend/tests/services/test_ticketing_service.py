from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from postgrest.exceptions import APIError

from core.errors import (
    PAYOUTS_NOT_READY,
    TICKET_ALREADY_REFUNDED,
    TICKET_CAPACITY_BELOW_SOLD,
    TICKET_PRICE_LOCKED,
    TICKET_PRICE_OUT_OF_RANGE,
    TICKET_QUANTITY_TOO_HIGH,
    TICKET_REFUND_AFTER_CHECK_IN,
    TICKET_REFUND_ALREADY_DECLINED,
    TICKET_REFUND_NOT_REQUESTED,
    TICKETED_DATE_IN_USE,
    TICKETED_EVENT_CLUB_LOCKED,
    TICKETING_DISABLED,
    TICKETS_SOLD_OUT,
)
from core.exceptions import ConflictError, NotFoundError, ServiceError, ValidationError
from schemas.club import ClubMemberResponse, ClubResponse
from schemas.event import EventResponse, EventUpdate
from schemas.event_date import OccurrenceUpdate
from schemas.ticketing import EventTicketingUpdate, TicketCheckoutCreate
from services import ticketing_service as module
from services.stripe_gateway import CheckoutSession, StripeEvent
from tests.conftest import make_db_user

DATE_ID = UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTHER_DATE_ID = UUID("aaaaaaaa-0000-0000-0000-000000000002")
ORDER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
SOON = datetime.now(timezone.utc) + timedelta(days=3)
MANAGER = make_db_user(id="33333333-3333-3333-3333-333333333333", email="officer@uwaterloo.ca")
BUYER = make_db_user(id="44444444-4444-4444-4444-444444444444", email="student@uwaterloo.ca")


def _event(**overrides) -> EventResponse:
    data = {
        "id": 9,
        "club_id": 7,
        "title": "Charity Gala",
        "club": "Gala Club",
        "location": "SLC Great Hall",
        "school": "uwaterloo",
        "added_at": datetime.now(timezone.utc),
        "occurrences": [
            {"id": str(DATE_ID), "event_id": 9, "dtstart_utc": SOON.isoformat()},
            {
                "id": str(OTHER_DATE_ID),
                "event_id": 9,
                "dtstart_utc": (SOON + timedelta(days=1)).isoformat(),
            },
        ],
        **overrides,
    }
    return EventResponse.model_validate(data)


def _order(**overrides) -> dict:
    return {
        "id": ORDER_ID,
        "event_id": 9,
        "event_date_id": str(DATE_ID),
        "club_id": 7,
        "buyer_user_id": str(BUYER.id),
        "buyer_email": BUYER.email,
        "quantity": 2,
        "unit_amount_cents": 1500,
        "currency": "cad",
        "status": "paid",
        "stripe_account_id": "acct_club7",
        "stripe_payment_intent_id": "pi_123",
        "reserved_until": (SOON + timedelta(hours=1)).isoformat(),
        **overrides,
    }


def _ticket(**overrides) -> dict:
    return {
        "id": "cccccccc-0000-0000-0000-000000000001",
        "order_id": ORDER_ID,
        "event_id": 9,
        "event_date_id": str(DATE_ID),
        "code": "ABCDEFGHIJKLMNOPQRSTUVWX",
        "status": "valid",
        "checked_in_at": None,
        "refunded_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ticket_orders": _order(),
        **overrides,
    }


@pytest.fixture
def sales(monkeypatch, fake_sb, patch_sb):
    """Ticketing switched on, the manager running club 7, and Supabase faked."""
    patch_sb("services.ticketing_service")
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"enabled": True}))
    monkeypatch.setattr(module.event_service, "get_event", MagicMock(return_value=_event()))
    monkeypatch.setattr(module.event_service, "update_event", MagicMock())
    monkeypatch.setattr(module.club_service, "get_managed_club", MagicMock())
    monkeypatch.setattr(
        module.club_service,
        "get_club",
        MagicMock(return_value=ClubResponse(id=7, club_name="Gala Club", logo_url=None)),
    )
    monkeypatch.setattr(
        module.club_payouts_service,
        "get_payment_account",
        MagicMock(return_value={"charges_enabled": True, "country": "CA"}),
    )
    monkeypatch.setattr(
        module.club_payouts_service,
        "require_charges_enabled",
        MagicMock(return_value={"charges_enabled": True, "country": "CA"}),
    )
    monkeypatch.setattr(module.ticket_emails, "send_refund_notice", MagicMock())
    monkeypatch.setattr(module.ticket_emails, "send_confirmation", MagicMock())
    monkeypatch.setattr(
        module.ticket_emails, "occurrence_label", MagicMock(return_value="Fri, Oct 24 · 7 PM")
    )
    return fake_sb


def test_ticket_codes_are_long_unguessable_base32():
    codes = {module.new_ticket_code() for _ in range(200)}
    assert len(codes) == 200
    assert all(len(code) == 24 and code.isalnum() and code.upper() == code for code in codes)


def test_a_code_scanned_as_its_ticket_link_reads_as_the_code():
    url = "https://uwaterloo.wat2do.io/tickets/abcdefghijklmnopqrstuvwx/"
    assert module.normalize_ticket_code(url) == "ABCDEFGHIJKLMNOPQRSTUVWX"
    assert module.normalize_ticket_code(" abcd-efgh ijkl ") == "ABCDEFGHIJKL"


def test_nothing_sells_while_ticketing_is_switched_off(monkeypatch):
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"enabled": False}))
    with pytest.raises(ValidationError, match=TICKETING_DISABLED):
        module.start_checkout(9, TicketCheckoutCreate(event_date_id=DATE_ID, quantity=1), BUYER)


def test_configuring_mirrors_the_price_onto_the_event(sales):
    # existing ticketing, valid tickets by date, then the reloaded row and seats taken
    sales.queue_responses(
        [
            [],
            [],
            [],
            [
                {
                    "event_id": 9,
                    "price_cents": 1500,
                    "currency": "cad",
                    "capacity": 100,
                    "sales_paused": False,
                }
            ],
            [],
        ]
    )

    view = module.configure_ticketing(
        9, EventTicketingUpdate(price_cents=1500, capacity=100), MANAGER
    )

    upserted = sales.upsert.call_args.args[0]
    assert upserted["price_cents"] == 1500 and upserted["currency"] == "cad"
    assert upserted["updated_by"] == str(MANAGER.id)
    module.event_service.update_event.assert_called_once_with(
        9, EventUpdate(price=15.0, registration=True)
    )
    assert view.on_sale is True
    assert [item.remaining for item in view.dates] == [100, 100]


def test_a_club_without_payouts_cannot_sell(sales, monkeypatch):
    monkeypatch.setattr(
        module.club_payouts_service,
        "require_charges_enabled",
        MagicMock(side_effect=ValidationError(PAYOUTS_NOT_READY)),
    )
    with pytest.raises(ValidationError, match=PAYOUTS_NOT_READY):
        module.configure_ticketing(9, EventTicketingUpdate(price_cents=1500), MANAGER)


@pytest.mark.parametrize("price_cents", [10, 10_000_000])
def test_prices_stay_within_the_allowed_range(sales, price_cents):
    with pytest.raises(ValidationError, match=TICKET_PRICE_OUT_OF_RANGE):
        module.configure_ticketing(9, EventTicketingUpdate(price_cents=price_cents), MANAGER)


def test_the_price_is_locked_once_tickets_sold(sales):
    sales.queue_responses(
        [
            [{"event_id": 9, "price_cents": 1500, "currency": "cad", "capacity": None}],
            [{"event_date_id": str(DATE_ID)}],
            [{"id": ORDER_ID}],
        ]
    )
    with pytest.raises(ConflictError, match=TICKET_PRICE_LOCKED):
        module.configure_ticketing(9, EventTicketingUpdate(price_cents=2000), MANAGER)


def test_capacity_never_drops_below_what_a_date_already_sold(sales):
    sold = [{"event_date_id": str(DATE_ID)}] * 3
    sales.queue_responses([[], sold])
    with pytest.raises(ConflictError, match=TICKET_CAPACITY_BELOW_SOLD):
        module.configure_ticketing(9, EventTicketingUpdate(price_cents=1500, capacity=2), MANAGER)


def test_checkout_is_a_direct_charge_on_the_clubs_account(sales, monkeypatch):
    created = MagicMock(
        return_value=CheckoutSession(id="cs_1", url="https://checkout.stripe.com/c/1")
    )
    monkeypatch.setattr(module.stripe_gateway, "create_checkout_session", created)
    sales.queue_responses([[_order(status="pending", quantity=2)], []])

    response = module.start_checkout(
        9, TicketCheckoutCreate(event_date_id=DATE_ID, quantity=2), BUYER
    )

    assert response.checkout_url == "https://checkout.stripe.com/c/1"
    account, params = created.call_args.args
    assert account == "acct_club7"
    assert created.call_args.kwargs["idempotency_key"] == f"ticket-checkout-{ORDER_ID}"
    assert params["client_reference_id"] == ORDER_ID
    assert params["line_items"][0]["quantity"] == 2
    assert params["line_items"][0]["price_data"]["unit_amount"] == 1500
    assert params["customer_email"] == BUYER.email
    assert params["success_url"].endswith(f"/tickets/orders/{ORDER_ID}")
    assert params["branding_settings"]["display_name"] == "Gala Club"
    # Stripe requires sessions to live at least 30 minutes from its own clock.
    assert params["expires_at"] - datetime.now(timezone.utc).timestamp() > 30 * 60
    rpc_args = sales.rpc.call_args.args[1]
    assert rpc_args["p_quantity"] == 2 and rpc_args["p_buyer_user_id"] == str(BUYER.id)
    sales.update.assert_called_with({"stripe_checkout_session_id": "cs_1"})


def test_a_sold_out_date_is_reported_plainly(sales):
    sales.raise_on_execute(APIError({"message": "TICKETS_SOLD_OUT", "code": "P0001"}))
    with pytest.raises(ValidationError, match=TICKETS_SOLD_OUT):
        module.start_checkout(9, TicketCheckoutCreate(event_date_id=DATE_ID, quantity=1), BUYER)


def test_a_checkout_stripe_refuses_releases_its_seats(sales, monkeypatch):
    monkeypatch.setattr(
        module.stripe_gateway,
        "create_checkout_session",
        MagicMock(side_effect=ServiceError("Payments are unavailable")),
    )
    sales.queue_responses([[_order(status="pending")], []])

    with pytest.raises(ServiceError):
        module.start_checkout(9, TicketCheckoutCreate(event_date_id=DATE_ID, quantity=1), BUYER)

    sales.update.assert_called_with({"status": "failed"})
    sales.eq.assert_any_call("status", "pending")


def test_one_order_never_exceeds_the_per_order_limit(sales):
    with pytest.raises(ValidationError, match=TICKET_QUANTITY_TOO_HIGH):
        module.start_checkout(9, TicketCheckoutCreate(event_date_id=DATE_ID, quantity=20), BUYER)


def test_a_paid_checkout_issues_tickets_and_queues_the_receipt(sales):
    # known order, the order again for its quantity, then the RPC's "issued now"
    sales.queue_responses([[{"id": ORDER_ID}], [_order()], True])
    event = StripeEvent(
        type="checkout.session.completed",
        account="acct_club7",
        object={
            "id": "cs_1",
            "client_reference_id": ORDER_ID,
            "payment_status": "paid",
            "payment_intent": "pi_123",
        },
    )

    after_response = module.handle_stripe_event(event)

    assert callable(after_response)
    rpc_args = sales.rpc.call_args.args[1]
    assert rpc_args["p_checkout_session_id"] == "cs_1"
    assert rpc_args["p_payment_intent_id"] == "pi_123"
    assert len(rpc_args["p_codes"]) == 2


def test_stripe_repeating_a_webhook_issues_nothing_twice(sales):
    sales.queue_responses([[{"id": ORDER_ID}], [_order()], False])
    event = StripeEvent(
        type="checkout.session.completed",
        account="acct_club7",
        object={"id": "cs_1", "client_reference_id": ORDER_ID, "payment_status": "paid"},
    )
    assert module.handle_stripe_event(event) is None


def test_a_checkout_wat2do_never_created_is_ignored(sales):
    event = StripeEvent(
        type="checkout.session.completed",
        account="acct_x",
        object={"id": "cs_x", "client_reference_id": "not-a-uuid", "payment_status": "paid"},
    )
    assert module.handle_stripe_event(event) is None
    sales.rpc.assert_not_called()


def test_an_abandoned_checkout_frees_its_seats(sales):
    sales.queue_responses([[{"id": ORDER_ID}], []])
    event = StripeEvent(
        type="checkout.session.expired",
        account="acct_club7",
        object={"id": "cs_1", "client_reference_id": ORDER_ID},
    )
    module.handle_stripe_event(event)
    sales.update.assert_called_with({"status": "expired"})


def test_the_receipt_goes_out_once_and_the_buyer_is_marked_going(sales, monkeypatch):
    monkeypatch.setattr(
        module.going_event_service, "get_going_event_selections", MagicMock(return_value=[])
    )
    set_going = MagicMock()
    monkeypatch.setattr(module.going_event_service, "set_going_occurrences", set_going)
    tickets = [_ticket(code="A" * 24), _ticket(code="B" * 24)]
    sales.queue_responses([[{"id": ORDER_ID}], [{**_order(), "tickets": tickets}]])

    module._after_fulfilment(UUID(ORDER_ID))

    set_going.assert_called_once_with(str(BUYER.id), 9, [DATE_ID])
    sent = module.ticket_emails.send_confirmation.call_args.kwargs
    assert sent["codes"] == ["A" * 24, "B" * 24]
    assert sent["club_name"] == "Gala Club"


def test_a_receipt_already_claimed_is_not_sent_again(sales):
    sales.queue_responses([[]])
    module._after_fulfilment(UUID(ORDER_ID))
    module.ticket_emails.send_confirmation.assert_not_called()


def test_refunding_one_ticket_refunds_exactly_its_price_once(sales, monkeypatch):
    refund = MagicMock(return_value="re_1")
    monkeypatch.setattr(module.stripe_gateway, "refund", refund)
    ticket = _ticket()
    sales.queue_responses([[ticket], [], [{**ticket, "status": "refunded"}], []])

    attendee = module.refund_ticket(9, UUID(ticket["id"]), MANAGER)

    refund.assert_called_once()
    assert refund.call_args.args == ("acct_club7",)
    assert refund.call_args.kwargs["amount_cents"] == 1500
    assert refund.call_args.kwargs["idempotency_key"] == f"ticket-refund-{ticket['id']}"
    assert attendee.status == "refunded"
    module.ticket_emails.send_refund_notice.assert_called_once()


def test_a_refunded_ticket_cannot_be_refunded_again(sales):
    sales.queue_responses([[_ticket(status="refunded")]])
    with pytest.raises(ConflictError, match=TICKET_ALREADY_REFUNDED):
        module.refund_ticket(9, uuid4(), MANAGER)


def test_cancelling_refunds_each_order_once_and_survives_one_failure(sales, monkeypatch):
    first = {**_order(id="o1"), "tickets": [_ticket(id="t1"), _ticket(id="t2")]}
    second = {**_order(id="o2"), "tickets": [_ticket(id="t3")]}
    gone = {**_order(id="o3"), "tickets": [_ticket(id="t4", status="refunded")]}
    sales.queue_responses([[first, second, gone]])
    refund = MagicMock(side_effect=["re_1", ServiceError("down")])
    monkeypatch.setattr(module.stripe_gateway, "refund", refund)

    refunded = module.refund_cancelled_event(9, refunded_by=str(MANAGER.id))

    assert refunded == 2
    assert [call.kwargs["amount_cents"] for call in refund.call_args_list] == [3000, 1500]
    module.ticket_emails.send_refund_notice.assert_called_once()
    assert module.ticket_emails.send_refund_notice.call_args.kwargs["reason"] == "cancelled"


@pytest.mark.parametrize(
    ("ticket", "result"),
    [
        (None, "not_found"),
        (_ticket(event_id=99), "not_for_this_event"),
        (_ticket(status="refunded"), "refunded"),
    ],
)
def test_the_door_explains_every_ticket_it_cannot_admit(sales, ticket, result):
    sales.queue_responses([[ticket] if ticket else [], []])
    assert module.set_check_in(9, "ABCDEFGHIJKLMNOPQRSTUVWX", True, MANAGER).result == result


def test_a_ticket_is_admitted_once(sales):
    admitted = _ticket(checked_in_at=datetime.now(timezone.utc).isoformat())
    sales.queue_responses([[_ticket()], [], [admitted], [admitted]])
    assert module.set_check_in(9, "ABCDEFGHIJKLMNOPQRSTUVWX", True, MANAGER).result == "checked_in"

    sales.queue_responses([[admitted], [], [], [admitted]])
    second = module.set_check_in(9, "ABCDEFGHIJKLMNOPQRSTUVWX", True, MANAGER)
    assert second.result == "already_checked_in"
    sales.is_.assert_any_call("checked_in_at", "null")


def test_a_ticketed_event_cannot_move_to_another_club(sales):
    sales.queue_responses([[{"event_id": 9}]])
    with pytest.raises(ConflictError, match=TICKETED_EVENT_CLUB_LOCKED):
        module.ensure_edit_keeps_tickets(_event(), EventUpdate(club_id=8))


def test_a_date_with_sold_tickets_cannot_be_removed(sales):
    paid = {"id": ORDER_ID, "event_date_id": str(OTHER_DATE_ID), "status": "paid"}
    sales.queue_responses([[{"event_id": 9}], [paid]])
    keep_first_date = EventUpdate(
        occurrences=[OccurrenceUpdate(id=DATE_ID, dtstart_utc=SOON, dtend_utc=None)]
    )
    with pytest.raises(ConflictError, match=TICKETED_DATE_IN_USE):
        module.ensure_edit_keeps_tickets(_event(), keep_first_date)


def test_edits_to_an_event_without_tickets_are_never_blocked(sales):
    sales.queue_responses([[]])
    module.ensure_edit_keeps_tickets(_event(), EventUpdate(club_id=8))


def test_the_club_dashboard_totals_each_ticketed_event(sales):
    sales.queue_responses(
        [
            [
                {
                    "event_id": 9,
                    "price_cents": 1500,
                    "currency": "cad",
                    "capacity": 50,
                    "sales_paused": False,
                }
            ],
            [
                {
                    "event_id": 9,
                    "checked_in_at": None,
                    "refund_requested_at": "2026-11-01T12:00:00+00:00",
                    "refund_declined_at": None,
                    "ticket_orders": {"unit_amount_cents": 1500},
                },
                {
                    "event_id": 9,
                    "checked_in_at": "2026-11-06T00:40:00+00:00",
                    "refund_requested_at": "2026-11-01T12:00:00+00:00",
                    "refund_declined_at": "2026-11-02T12:00:00+00:00",
                    "ticket_orders": {"unit_amount_cents": 1500},
                },
            ],
        ]
    )

    [summary] = module.club_ticket_summaries(ClubResponse(id=7, club_name="Gala Club"))

    assert (summary.sold, summary.checked_in, summary.revenue_cents) == (2, 1, 3000)
    assert summary.refund_requests == 1
    sales.eq.assert_any_call("events.club_id", 7)
    sales.eq.assert_any_call("status", "valid")


REQUESTED_AT = "2026-11-01T12:00:00+00:00"


def _members(*emails: str) -> list[ClubMemberResponse]:
    return [
        ClubMemberResponse(
            user_id=uuid4(), email=email, role="Member", joined_at=datetime.now(timezone.utc)
        )
        for email in emails
    ]


@pytest.fixture
def requests(sales, monkeypatch):
    """Refund request emails captured, and club 7 run by two officers."""
    monkeypatch.setattr(module.ticket_emails, "send_refund_request", MagicMock())
    monkeypatch.setattr(module.ticket_emails, "send_refund_declined", MagicMock())
    monkeypatch.setattr(
        module.club_service,
        "list_club_members",
        MagicMock(return_value=_members("b@uwaterloo.ca", "a@uwaterloo.ca")),
    )
    return sales


def test_a_holder_asks_for_a_refund_and_every_officer_hears_once(requests):
    ticket = _ticket()
    requests.queue_responses(
        [
            [ticket],
            [{"id": str(BUYER.id), "full_name": "Sam Kim"}],
            [{"refund_requested_at": REQUESTED_AT, "refund_request_note": "Can't make it"}],
        ]
    )

    view = module.request_refund(ticket["code"], BUYER, "  Can't make it  ")

    written = requests.update.call_args.args[0]
    assert written["refund_request_note"] == "Can't make it" and written["refund_requested_at"]
    requests.is_.assert_any_call("refund_requested_at", "null")
    sent = module.ticket_emails.send_refund_request.call_args.kwargs
    assert sent["recipients"] == ["a@uwaterloo.ca", "b@uwaterloo.ca"]
    assert sent["holder_name"] == "Sam Kim" and sent["club_name"] == "Gala Club"
    assert view.refund_requested_at is not None and view.can_request_refund is False


def test_asking_twice_writes_and_emails_nothing(requests):
    ticket = _ticket(refund_requested_at=REQUESTED_AT)
    requests.queue_responses([[ticket], [{"id": str(BUYER.id), "full_name": "Sam Kim"}]])

    view = module.request_refund(ticket["code"], BUYER, None)

    requests.update.assert_not_called()
    module.ticket_emails.send_refund_request.assert_not_called()
    assert view.refund_requested_at is not None


def test_only_the_buyer_can_ask_for_a_refund(requests):
    requests.queue_responses([[_ticket()]])
    with pytest.raises(NotFoundError):
        module.request_refund("ABCDEFGHIJKLMNOPQRSTUVWX", MANAGER, None)


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"checked_in_at": "2026-11-06T00:40:00+00:00"}, TICKET_REFUND_AFTER_CHECK_IN),
        (
            {"refund_requested_at": REQUESTED_AT, "refund_declined_at": REQUESTED_AT},
            TICKET_REFUND_ALREADY_DECLINED,
        ),
        ({"status": "refunded", "refunded_at": REQUESTED_AT}, TICKET_ALREADY_REFUNDED),
    ],
)
def test_used_declined_or_refunded_tickets_cannot_ask_again(requests, overrides, error):
    requests.queue_responses([[_ticket(**overrides)]])
    with pytest.raises(ConflictError, match=error):
        module.request_refund("ABCDEFGHIJKLMNOPQRSTUVWX", BUYER, None)
    module.ticket_emails.send_refund_request.assert_not_called()


def test_declining_keeps_the_ticket_and_tells_the_holder_once(requests):
    ticket = _ticket(refund_requested_at=REQUESTED_AT)
    declined = {**ticket, "refund_declined_at": "2026-11-02T12:00:00+00:00"}
    requests.queue_responses([[ticket], [declined], [declined], []])

    attendee = module.decline_refund_request(9, UUID(ticket["id"]), MANAGER)

    requests.is_.assert_any_call("refund_declined_at", "null")
    module.ticket_emails.send_refund_declined.assert_called_once()
    assert attendee.status == "valid" and attendee.refund_declined_at is not None


def test_a_ticket_nobody_asked_about_cannot_be_declined(requests):
    requests.queue_responses([[_ticket()]])
    with pytest.raises(ConflictError, match=TICKET_REFUND_NOT_REQUESTED):
        module.decline_refund_request(9, uuid4(), MANAGER)


def test_the_buyer_sees_they_can_ask_and_an_officer_does_not(sales):
    ticket = _ticket()
    names = [{"id": str(BUYER.id), "full_name": "Sam Kim"}]
    sales.queue_responses([[ticket], names])
    assert module.ticket_by_code(ticket["code"], BUYER).can_request_refund is True
    sales.queue_responses([[ticket], names])
    assert module.ticket_by_code(ticket["code"], MANAGER).can_request_refund is False


def test_ticket_buyers_are_found_for_the_public_going_list(sales):
    sales.queue_responses([[{"buyer_user_id": str(BUYER.id)}, {"buyer_user_id": str(BUYER.id)}]])
    assert module.ticket_buyer_ids(9) == {str(BUYER.id)}
    sales.eq.assert_any_call("status", "paid")


def test_a_changed_event_offers_each_holder_the_way_to_ask_for_a_refund(sales):
    other = str(uuid4())
    asked = str(uuid4())
    sales.queue_responses(
        [
            [
                _ticket(code="A" * 24),
                _ticket(code="B" * 24, ticket_orders=_order(buyer_user_id=other)),
                _ticket(code="C" * 24, ticket_orders=_order(buyer_user_id=other)),
                _ticket(
                    code="D" * 24,
                    refund_requested_at=REQUESTED_AT,
                    ticket_orders=_order(buyer_user_id=asked),
                ),
            ]
        ]
    )

    links = module.refund_request_links(_event(), [str(BUYER.id), other, asked])

    assert links[str(BUYER.id)].endswith(f"/tickets/{'A' * 24}?refund=1")
    assert links[other].endswith("/tickets")
    assert asked not in links
