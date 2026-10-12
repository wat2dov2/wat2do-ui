from __future__ import annotations

import email
import email.policy
from unittest.mock import MagicMock

import pytest

from services import email_service as email_module
from services.email_service import EmailMessage, EmailService, InlineImage


def _message(**overrides) -> EmailMessage:
    defaults = {
        "to": "student@uwaterloo.ca",
        "subject": "Wat2do update",
        "body_html": "<p>Hello</p>",
        "body_text": "Hello",
        "idempotency_key": "event_change:user-1:event-1",
    }
    defaults.update(overrides)
    return EmailMessage(**defaults)


def test_send_with_delivery_disabled_uses_dry_run(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", False)
    ses = MagicMock()

    assert EmailService(ses_client=ses).send(_message()) is True
    ses.send_email.assert_not_called()


@pytest.mark.parametrize(
    ("recipients", "addresses"),
    [
        ("student@uwaterloo.ca", ["student@uwaterloo.ca"]),
        (
            ["e22han@uwaterloo.ca", "tqiu@uwaterloo.ca"],
            ["e22han@uwaterloo.ca", "tqiu@uwaterloo.ca"],
        ),
    ],
)
def test_send_builds_raw_ses_message(monkeypatch, recipients, addresses):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", True)
    monkeypatch.setattr(email_module.settings, "email_from", "wat2do <notifications@wat2do.io>")
    ses = MagicMock()

    message = _message(
        to=recipients,
        reply_to="sender@example.com",
        headers={"List-Unsubscribe": "<https://wat2do.io/unsubscribe>"},
    )
    assert EmailService(ses_client=ses).send(message) is True

    request = ses.send_email.call_args.kwargs
    assert request["Destination"] == {"ToAddresses": addresses}
    sent = _sent_mime(ses)
    assert sent["From"] == "wat2do <notifications@wat2do.io>"
    assert sent["To"] == ", ".join(addresses)
    assert sent["Subject"] == "Wat2do update"
    assert sent["Reply-To"] == "sender@example.com"
    assert sent["List-Unsubscribe"] == "<https://wat2do.io/unsubscribe>"
    assert sent.get_body(("plain",)).get_content().strip() == "Hello"
    assert sent.get_body(("html",)).get_content().strip() == "<p>Hello</p>"


def _sent_mime(ses):
    raw = ses.send_email.call_args.kwargs["Content"]["Raw"]["Data"]
    return email.message_from_bytes(raw, policy=email.policy.default)


_LOGO = InlineImage(
    content_id="wat2do-logo", filename="logo.png", content_type="image/png", content=b"png"
)


def test_inline_images_ride_inside_the_html_part(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", True)
    ses = MagicMock()
    EmailService(ses_client=ses).send(_message(inline_images=[_LOGO]))
    html = _sent_mime(ses).get_body(("related",))
    assert [part.get_content_type() for part in html.iter_parts()] == ["text/html", "image/png"]
    image = list(html.iter_parts())[1]
    assert (image["Content-ID"], image.get_content_disposition()) == ("<wat2do-logo>", "inline")
    assert image.get_content() == b"png"


def test_ses_errors_bubble_to_caller(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", True)
    ses = MagicMock()
    ses.send_email.side_effect = RuntimeError("MessageRejected")

    with pytest.raises(RuntimeError, match="MessageRejected"):
        EmailService(ses_client=ses).send(_message())


def test_send_safely_logs_and_returns_false(monkeypatch):
    service = EmailService()
    monkeypatch.setattr(service, "send", MagicMock(side_effect=RuntimeError("SES down")))

    assert service.send_safely(_message()) is False


def test_send_rejects_legacy_sender_before_dry_run(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", False)
    monkeypatch.setattr(
        email_module.settings,
        "email_from",
        "wat2do <notifications@wat2do.ca>",
    )

    with pytest.raises(RuntimeError, match="EMAIL_FROM must use wat2do.io"):
        EmailService().send(_message())


@pytest.mark.parametrize(
    ("field", "body"),
    [
        ("body_html", '<a href="https://uwaterloo.wat2do.ca/events/42">View</a>'),
        ("body_text", "View: https://wat2do.ca/events/42"),
    ],
)
def test_send_rejects_legacy_links_before_dry_run(monkeypatch, field, body):
    monkeypatch.setattr(email_module.settings, "email_delivery_enabled", False)
    monkeypatch.setattr(
        email_module.settings,
        "email_from",
        "wat2do <notifications@wat2do.io>",
    )

    with pytest.raises(RuntimeError, match="Outbound email links must use wat2do.io"):
        EmailService().send(_message(**{field: body}))
