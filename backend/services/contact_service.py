"""Build outbound contact messages without coupling the service to FastAPI."""

from html import escape

from core.controlbox import controlbox
from schemas.contact import ContactCreate
from services.email_service import EmailMessage


def build_contact_email(data: ContactCreate) -> EmailMessage:
    sender = str(data.email)
    safe_email = escape(sender)
    safe_message = "<br>".join(escape(data.message).splitlines())

    return EmailMessage(
        to=str(controlbox.contact.recipient_email),
        reply_to=sender,
        subject="[Wat2Do contact] New message",
        body_html=(
            "<h2>New Wat2Do contact message</h2>"
            f"<p><strong>From:</strong> {safe_email}</p>"
            f"<p>{safe_message}</p>"
        ),
        body_text=f"New Wat2Do contact message\n\nFrom: {sender}\n{data.message}",
    )
