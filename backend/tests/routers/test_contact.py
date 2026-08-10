from unittest.mock import MagicMock

from services import contact_service
from services.email_service import EmailMessage


def _message() -> EmailMessage:
    return EmailMessage(
        to="contact@wat2do.io",
        reply_to="student@uwaterloo.ca",
        subject="[Wat2Do contact] New message",
        body_html="<p>Hello</p>",
        body_text="Hello",
    )


def test_submit_contact_message_queues_email(client, monkeypatch):
    message = _message()
    build = MagicMock(return_value=message)
    dispatch = MagicMock(return_value=True)
    monkeypatch.setattr(contact_service, "build_contact_email", build)
    monkeypatch.setattr("routers.contact.email_service.send_safely", dispatch)

    response = client.post(
        "/contact/",
        json={
            "email": "student@uwaterloo.ca",
            "message": "Hello",
        },
    )

    assert response.status_code == 202
    build.assert_called_once()
    dispatch.assert_called_once_with(message)


def test_submit_contact_message_rejects_invalid_input(client):
    response = client.post(
        "/contact/",
        json={
            "email": "not-an-email",
            "message": "   ",
        },
    )

    assert response.status_code == 422


def test_submit_contact_message_rejects_removed_name_field(client):
    response = client.post(
        "/contact/",
        json={
            "name": "Student",
            "email": "student@uwaterloo.ca",
            "message": "Hello",
        },
    )

    assert response.status_code == 422


def test_build_contact_email_escapes_html():
    from schemas.contact import ContactCreate

    message = contact_service.build_contact_email(
        ContactCreate(
            email="student@uwaterloo.ca",
            message="Hello <strong>team</strong>",
        )
    )

    assert message.to == "contact@wat2do.io"
    assert message.reply_to == "student@uwaterloo.ca"
    assert "<script>" not in message.body_html
    assert "<strong>team</strong>" not in message.body_html
