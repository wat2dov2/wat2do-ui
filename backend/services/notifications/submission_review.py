"""Tell a submitter, from the team address, that we approved or rejected their club, event or position."""

from html import escape
from typing import Literal

from core.constants import SUBMISSION_APPROVED, SUBMISSION_REJECTED
from core.controlbox import controlbox
from services.email_layout import (
    EMAIL_LOGO,
    email_button,
    email_paragraph,
    email_quote,
    email_shell,
)
from services.email_service import EmailMessage, email_service
from services.school_context import school_frontend_url

ReviewedKind = Literal["club", "event", "position"]

_CLOSING = "Questions? Reply to this email and our team will get back to you."


def send_review_decision(
    *,
    kind: ReviewedKind,
    title: str,
    status: str,
    recipient: str | None,
    school: str | None,
    path: str,
    rejection_reason: str | None = None,
) -> None:
    """Email the decision after a review moves a submission to approved or rejected.

    ``path`` is where the approved item lives on the school's site. Delivery
    failures are logged, never raised, so they cannot undo the review.
    """
    if not recipient or status not in (SUBMISSION_APPROVED, SUBMISSION_REJECTED):
        return
    email_service.send_safely(
        build_review_decision_email(
            kind=kind,
            title=title,
            approved=status == SUBMISSION_APPROVED,
            recipient=recipient,
            url=f"{school_frontend_url(school)}{path}",
            rejection_reason=(rejection_reason or "").strip() or None,
        )
    )


def build_review_decision_email(
    *,
    kind: ReviewedKind,
    title: str,
    approved: bool,
    recipient: str,
    url: str,
    rejection_reason: str | None,
) -> EmailMessage:
    if approved:
        subject = f"Your {kind} {title} is live on wat2do"
        heading = f"{title} is approved"
        intro = f"Thanks for submitting your {kind}. We reviewed it and it is now live on wat2do."
        details_html = email_button(url, f"View your {kind}")
        details_text = f"View your {kind}: {url}"
    else:
        subject = f"We could not approve your {kind} {title}"
        heading = f"{title} was not approved"
        intro = (
            f"Thanks for submitting your {kind}. We reviewed it and could not approve it this time."
        )
        details_html = (
            email_paragraph("Reason:", muted=True)
            + email_quote("<br>".join(escape(rejection_reason).splitlines()))
            if rejection_reason
            else ""
        )
        details_text = f"Reason: {rejection_reason}" if rejection_reason else ""
    return EmailMessage(
        to=recipient,
        sender=controlbox.email_delivery.team_sender,
        subject=subject,
        body_html=email_shell(
            heading=heading,
            content=(
                email_paragraph(escape(intro), muted=True)
                + details_html
                + email_paragraph(escape(_CLOSING), muted=True)
            ),
        ),
        body_text="\n\n".join(part for part in (intro, details_text, _CLOSING) if part),
        inline_images=[EMAIL_LOGO],
    )
