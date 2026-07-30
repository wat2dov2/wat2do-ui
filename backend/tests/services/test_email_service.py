from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from services import email_service as email_module
from services.email_service import EmailMessage, EmailService


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
