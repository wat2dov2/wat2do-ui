from unittest.mock import MagicMock

import pytest

from core.config import settings
from schemas.ticketing import TicketCheckInResponse, TicketCheckoutResponse
from services import club_service, ticketing_service
from services.stripe_gateway import StripeEvent
from tests.conftest import FAKE_USER

ORDER_ID = "bbbbbbbb-0000-0000-0000-000000000001"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("put", "/events/9/ticketing"),
        ("post", "/events/9/ticketing/checkout"),
        ("get", "/events/9/ticketing/sales"),
        ("put", "/events/9/ticketing/check-ins/ABC"),
        ("get", "/tickets/mine"),
        ("get", f"/tickets/orders/{ORDER_ID}"),
        ("post", "/tickets/ABCDEFGH/refund-request"),
        ("post", f"/events/9/ticketing/tickets/{ORDER_ID}/refund-request/decline"),
        ("get", "/clubs/7/payouts"),
    ],
)
def test_ticketing_actions_require_signing_in(client, method, path):
    assert client.request(method.upper(), path, json={}).status_code == 401


def test_anyone_sees_what_an_event_sells(client, monkeypatch):
    monkeypatch.setattr(ticketing_service, "get_event_ticketing", MagicMock(return_value=None))
    response = client.get("/events/9/ticketing")
    assert response.status_code == 200 and response.json() is None


def test_checkout_returns_stripes_url(authenticated_client, monkeypatch):
    start = MagicMock(
        return_value=TicketCheckoutResponse(order_id=ORDER_ID, checkout_url="https://pay")
    )
    monkeypatch.setattr(ticketing_service, "start_checkout", start)

    response = authenticated_client.post(
        "/events/9/ticketing/checkout",
        json={"event_date_id": "aaaaaaaa-0000-0000-0000-000000000001", "quantity": 2},
    )

    assert response.status_code == 200
    assert response.json()["checkout_url"] == "https://pay"
    assert start.call_args.args[2].id.hex == FAKE_USER["id"].replace("-", "")


def test_the_door_scanner_passes_the_code_through(authenticated_client, monkeypatch):
    check_in = MagicMock(return_value=TicketCheckInResponse(result="not_found"))
    monkeypatch.setattr(ticketing_service, "set_check_in", check_in)

    response = authenticated_client.put(
        "/events/9/ticketing/check-ins/ABCDEFGH", json={"checked_in": False}
    )

    assert response.json() == {"result": "not_found", "attendee": None}
    assert check_in.call_args.args[1:3] == ("ABCDEFGH", False)


def test_payouts_belong_to_the_clubs_managers(authenticated_client, monkeypatch):
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=None))
    assert authenticated_client.get("/clubs/7/payouts").status_code == 404


def test_a_forged_stripe_webhook_is_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_123")
    response = client.post(
        "/webhooks/stripe", content=b"{}", headers={"stripe-signature": "t=1,v1=forged"}
    )
    assert response.status_code == 401


def test_a_verified_webhook_runs_its_follow_up_after_answering(client, monkeypatch):
    event = StripeEvent(type="checkout.session.completed", account="acct_1", object={})
    monkeypatch.setattr(
        "routers.webhooks.stripe_gateway.verified_event", MagicMock(return_value=event)
    )
    follow_up = MagicMock()
    monkeypatch.setattr(ticketing_service, "handle_stripe_event", MagicMock(return_value=follow_up))

    response = client.post("/webhooks/stripe", content=b"{}", headers={"stripe-signature": "s"})

    assert response.json() == {"received": True}
    follow_up.assert_called_once_with()


def test_a_holder_sends_their_refund_request_and_note(authenticated_client, monkeypatch):
    request = MagicMock(
        return_value={
            "code": "A" * 24,
            "status": "valid",
            "event_id": 9,
            "event_title": "Charity Gala",
            "event_date_id": "aaaaaaaa-0000-0000-0000-000000000001",
            "dtstart_utc": "2026-11-14T00:00:00Z",
            "holder_name": "Sam K.",
            "refund_requested_at": "2026-11-01T12:00:00Z",
        }
    )
    monkeypatch.setattr(ticketing_service, "request_refund", request)

    response = authenticated_client.post(
        f"/tickets/{'A' * 24}/refund-request", json={"note": "Can't make it"}
    )

    assert response.status_code == 200
    assert response.json()["refund_requested_at"].startswith("2026-11-01")
    called = request.call_args.args
    assert called[0] == "A" * 24 and called[2] == "Can't make it"


def test_a_refund_note_is_kept_short(authenticated_client):
    response = authenticated_client.post(
        f"/tickets/{'A' * 24}/refund-request", json={"note": "x" * 501}
    )
    assert response.status_code == 422


def test_an_officer_declines_a_refund_request(authenticated_client, monkeypatch):
    decline = MagicMock(
        return_value={
            "id": ORDER_ID,
            "code": "A" * 24,
            "status": "valid",
            "event_date_id": "aaaaaaaa-0000-0000-0000-000000000001",
            "holder_name": "Sam Kim",
            "holder_email": "sam@uwaterloo.ca",
            "purchased_at": "2026-11-01T12:00:00Z",
            "amount_cents": 2500,
            "refund_requested_at": "2026-11-01T12:00:00Z",
            "refund_declined_at": "2026-11-02T12:00:00Z",
        }
    )
    monkeypatch.setattr(ticketing_service, "decline_refund_request", decline)

    response = authenticated_client.post(
        f"/events/9/ticketing/tickets/{ORDER_ID}/refund-request/decline"
    )

    assert response.status_code == 200
    assert response.json()["refund_declined_at"].startswith("2026-11-02")
    assert decline.call_args.args[0] == 9
