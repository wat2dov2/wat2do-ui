from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

from schemas.event import EventResponse
from services import ticket_emails as module
from services.email_service import InlineImage

START = datetime(2026, 11, 6, 0, 30, tzinfo=timezone.utc)


@pytest.fixture
def sent(monkeypatch):
    send = MagicMock()
    monkeypatch.setattr(module.email_service, "send_safely", send)
    monkeypatch.setattr(module, "event_hero_image", MagicMock(return_value=None))
    monkeypatch.setattr(module, "_school_zone", lambda school: ZoneInfo("America/Toronto"))
    logo = InlineImage(
        content_id="wat2do-logo", filename="logo.png", content_type="image/png", content=b""
    )
    monkeypatch.setattr(module, "email_logo", MagicMock(return_value=logo))
    return send


def _event() -> EventResponse:
    return EventResponse.model_validate(
        {
            "id": 9,
            "title": "Charity Gala",
            "club": "Gala Club",
            "location": "SLC Great Hall",
            "school": "uwaterloo",
            "added_at": START,
            "occurrences": [
                {
                    "id": "aaaaaaaa-0000-0000-0000-000000000001",
                    "event_id": 9,
                    "dtstart_utc": START.isoformat(),
                    "dtend_utc": (START + timedelta(hours=3)).isoformat(),
                }
            ],
        }
    )


ORDER = {
    "id": "o1",
    "buyer_email": "student@uwaterloo.ca",
    "unit_amount_cents": 1500,
    "currency": "cad",
}


def test_the_receipt_carries_one_scannable_qr_per_ticket(sent):
    event = _event()
    module.send_confirmation(
        order=ORDER,
        codes=["A" * 24, "B" * 24],
        event=event,
        occurrence=event.occurrences[0],
        club_name="Gala Club",
    )

    message = sent.call_args.args[0]
    assert message.subject == "Your tickets for Charity Gala"
    assert message.to == ["student@uwaterloo.ca"]
    qr = [image for image in message.inline_images if image.content_id.startswith("ticket-")]
    assert len(qr) == 2 and all(image.content.startswith(b"\x89PNG") for image in qr)
    assert "$30.00 CAD" in message.body_html and "Gala Club" in message.body_html
    assert "Thu, Nov 5 · 7:30 PM - 10:30 PM" in message.body_text
    assert f"/tickets/{'A' * 24}" in message.body_text
    assert message.idempotency_key == "ticket-confirmation:o1"
    # The way to a refund is the ticket page, never a reply that bounces between club and Wat2Do.
    assert "no booking fees" in message.body_html and "reply to this email" not in message.body_html
    assert "Ask Gala Club for a refund from your ticket page" in message.body_text


def test_a_cancellation_notice_says_the_money_is_coming_back(sent):
    module.send_refund_notice(
        order=ORDER,
        count=2,
        amount_cents=3000,
        event=_event(),
        club_name="Gala Club",
        reason="cancelled",
    )
    message = sent.call_args.args[0]
    assert message.subject == "Charity Gala was cancelled: you've been refunded"
    assert "$30.00 CAD" in message.body_text
    assert "were refunded automatically" in message.body_text


TICKET = {
    "id": "cccccccc-0000-0000-0000-000000000001",
    "code": "A" * 24,
    "refund_request_note": "I can't make the new date",
}


def test_a_refund_request_reaches_every_officer_with_the_note(sent):
    module.send_refund_request(
        ticket=TICKET,
        order=ORDER,
        holder_name="Sam Kim",
        event=_event(),
        club_name="Gala Club",
        recipients=["a@uwaterloo.ca", "b@uwaterloo.ca"],
    )

    message = sent.call_args.args[0]
    assert message.to == ["a@uwaterloo.ca", "b@uwaterloo.ca"]
    assert message.subject == "Refund request: Charity Gala"
    assert "Sam Kim asked Gala Club for a refund of one $15.00 CAD ticket" in message.body_text
    assert "I can&#x27;t make the new date" in message.body_html
    assert "/club-panel/events/9" in message.body_text
    assert message.idempotency_key == f"ticket-refund-request:{TICKET['id']}"


def test_a_refund_request_with_no_officers_sends_nothing(sent):
    module.send_refund_request(
        ticket=TICKET, order=ORDER, holder_name="Sam", event=_event(), club_name=None, recipients=[]
    )
    sent.assert_not_called()


def test_a_declined_request_tells_the_holder_their_ticket_still_works(sent):
    module.send_refund_declined(ticket=TICKET, order=ORDER, event=_event(), club_name="Gala Club")

    message = sent.call_args.args[0]
    assert message.to == ["student@uwaterloo.ca"]
    assert message.subject == "Your refund request for Charity Gala"
    assert "Gala Club declined your refund request" in message.body_text
    assert "Your ticket still works" in message.body_text
    assert f"/tickets/{'A' * 24}" in message.body_text
