"""Build outbound contact messages without coupling the service to FastAPI."""

from html import escape

from core.controlbox import controlbox
from schemas.contact import ContactCreate
from services.email_layout import EMAIL_LOGO, email_paragraph, email_quote, email_shell
from services.email_service import EmailMessage


def build_contact_email(data: ContactCreate) -> EmailMessage:
    sender = str(data.email)
    message = "<br>".join(escape(data.message).splitlines())

    return EmailMessage(
        to=[str(email) for email in controlbox.contact.recipient_emails],
        reply_to=sender,
        subject="[Wat2Do contact] New message",
        body_html=email_shell(
            heading="New contact message",
            content=(
                email_paragraph(
                    f"From <strong>{escape(sender)}</strong>. Reply to answer them.", muted=True
                )
                + email_quote(message)
            ),
        ),
        body_text=f"New wat2do contact message\n\nFrom: {sender}\n{data.message}",
        inline_images=[EMAIL_LOGO],
    )
