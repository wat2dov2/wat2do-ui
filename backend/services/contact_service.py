"""Build outbound contact messages without coupling the service to FastAPI."""

from html import escape

from core.controlbox import controlbox
from schemas.contact import ContactCreate
from services.email_service import EmailMessage


def build_contact_email(data: ContactCreate) -> EmailMessage:
    sender = str(data.email)
    safe_name = escape(data.name)
    safe_email = escape(sender)
    safe_subject = escape(data.subject)
    safe_message = "<br>".join(escape(data.message).splitlines())

    return EmailMessage(
        to=str(controlbox.contact.recipient_email),
        reply_to=sender,
        subject=f"[Wat2Do contact] {data.subject}",
        body_html=(
            "<h2>New Wat2Do contact message</h2>"
            f"<p><strong>From:</strong> {safe_name} &lt;{safe_email}&gt;</p>"
            f"<p><strong>Subject:</strong> {safe_subject}</p>"
            f"<p>{safe_message}</p>"
        ),
        body_text=(
            "New Wat2Do contact message\n\n"
            f"From: {data.name} <{sender}>\n"
            f"Subject: {data.subject}\n\n"
            f"{data.message}"
        ),
    )
