from __future__ import annotations

import email
import email.policy
from unittest.mock import MagicMock

import httpx
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


def test_send_without_provider_uses_dry_run(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "")
    post = MagicMock()
    monkeypatch.setattr(email_module.httpx, "post", post)

    assert EmailService().send(_message()) is True
    post.assert_not_called()


def test_resend_dispatch_posts_email(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "re_test")
    monkeypatch.setattr(
        email_module.settings,
        "email_from",
        "wat2do <notifications@wat2do.io>",
    )
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured.update(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return httpx.Response(
            200,
            json={"id": "email_123"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(email_module.httpx, "post", fake_post)

    assert EmailService().send(_message()) is True

    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["json"] == {
        "from": "wat2do <notifications@wat2do.io>",
        "to": "student@uwaterloo.ca",
        "subject": "Wat2do update",
        "html": "<p>Hello</p>",
        "text": "Hello",
        "headers": {},
    }
    assert captured["headers"] == {
        "Authorization": "Bearer re_test",
        "Content-Type": "application/json",
        "Idempotency-Key": "event_change:user-1:event-1",
    }
    assert captured["timeout"] == 10


def test_resend_dispatch_omits_empty_idempotency_key(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "re_test")
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured["headers"] = headers
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_module.httpx, "post", fake_post)

    assert EmailService().send(_message(idempotency_key=None)) is True
    assert "Idempotency-Key" not in captured["headers"]


@pytest.mark.parametrize(
    "recipients", ["student@uwaterloo.ca", ["e22han@uwaterloo.ca", "tqiu@uwaterloo.ca"]]
)
def test_resend_dispatch_includes_reply_to(monkeypatch, recipients):
    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "re_test")
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured["json"] = json
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_module.httpx, "post", fake_post)

    assert EmailService().send(_message(to=recipients, reply_to="sender@example.com")) is True
    assert captured["json"]["to"] == recipients
    assert captured["json"]["reply_to"] == "sender@example.com"


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
def test_ses_dispatch_sends_simple_email(monkeypatch, recipients, addresses):
    monkeypatch.setattr(email_module.settings, "email_provider", "ses")
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


def test_inline_images_ride_inside_the_message_for_each_provider(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "ses")
    ses = MagicMock()
    EmailService(ses_client=ses).send(_message(inline_images=[_LOGO]))
    html = _sent_mime(ses).get_body(("related",))
    assert [part.get_content_type() for part in html.iter_parts()] == ["text/html", "image/png"]
    image = list(html.iter_parts())[1]
    assert (image["Content-ID"], image.get_content_disposition()) == ("<wat2do-logo>", "inline")
    assert image.get_content() == b"png"

    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "re_test")
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured["json"] = json
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_module.httpx, "post", fake_post)
    EmailService().send(_message(inline_images=[_LOGO]))
    assert captured["json"]["attachments"] == [
        {
            "filename": "logo.png",
            "content": "cG5n",
            "content_type": "image/png",
            "content_id": "wat2do-logo",
        }
    ]


def test_ses_errors_bubble_to_caller(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "ses")
    ses = MagicMock()
    ses.send_email.side_effect = RuntimeError("MessageRejected")

    with pytest.raises(RuntimeError, match="MessageRejected"):
        EmailService(ses_client=ses).send(_message())


def test_send_safely_logs_and_returns_false(monkeypatch):
    service = EmailService()
    monkeypatch.setattr(service, "send", MagicMock(side_effect=RuntimeError("provider down")))

    assert service.send_safely(_message()) is False


def test_resend_requires_api_key(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "")

    with pytest.raises(RuntimeError, match="EMAIL_PROVIDER_API_KEY"):
        EmailService().send(_message())


def test_resend_http_error_bubbles_to_caller(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "resend")
    monkeypatch.setattr(email_module.settings, "email_provider_api_key", "re_test")

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            422,
            json={"message": "Invalid `from` field"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(email_module.httpx, "post", fake_post)

    with pytest.raises(httpx.HTTPStatusError):
        EmailService().send(_message())


def test_send_rejects_legacy_sender_before_dry_run(monkeypatch):
    monkeypatch.setattr(email_module.settings, "email_provider", "")
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
    monkeypatch.setattr(email_module.settings, "email_provider", "")
    monkeypatch.setattr(
        email_module.settings,
        "email_from",
        "wat2do <notifications@wat2do.io>",
    )

    with pytest.raises(RuntimeError, match="Outbound email links must use wat2do.io"):
        EmailService().send(_message(**{field: body}))
