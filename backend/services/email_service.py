"""Email-sending gateway for transactional app email.

Class-based because it wraps an external client (per the layered
architecture convention - see backend-architecture.md). The module-level
singleton ``email_service`` is what callers import; tests monkeypatch
the instance directly.

DRY-RUN by default: if no ``EMAIL_PROVIDER`` is set in settings,
``send()`` logs the message and returns success without dispatching. That
lets the rest of the notifications pipeline (enqueue, dedup, log writes,
cron composition) run end-to-end locally and in CI without a provider
API key.
"""

from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass, field
from email.message import EmailMessage as MimeMessage

import boto3  # type: ignore[import-untyped]
import httpx
from botocore.config import Config  # type: ignore[import-untyped]

from core.config import settings
from core.controlbox import controlbox

log = logging.getLogger(__name__)

RESEND_EMAILS_URL = "https://api.resend.com/emails"
_LEGACY_WAT2DO_URL = re.compile(
    r"https?://(?:[a-z0-9-]+\.)*wat2do\.ca(?=[:/?#\s\"'<]|$)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class InlineImage:
    """An image carried inside the message and referenced from HTML as ``cid:<content_id>``.

    Clients such as Outlook block remote images from unfamiliar senders but
    show embedded ones.
    """

    content_id: str
    filename: str
    content_type: str
    content: bytes


@dataclass
class EmailMessage:
    to: str | list[str]
    subject: str
    body_html: str
    body_text: str
    reply_to: str | None = None
    # Stable per-send key - the provider (when configured) uses it for
    # its own idempotency; inside our own log the (user, type, target, channel)
    # UNIQUE constraint already protects us, so this is purely belt-and-
    # suspenders in case a cron restart re-hits the provider before our
    # ``UPDATE status='sent'`` commits.
    idempotency_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    inline_images: list[InlineImage] = field(default_factory=list)


class EmailService:
    """Thin wrapper around the outbound email provider (Resend or Amazon SES).

    Methods intentionally take an ``EmailMessage`` rather than positional
    ``to/subject/...`` so the call site is a single stable signature
    across providers. Provider-specific headers (reply-to, sender domain)
    get set inside ``_dispatch_*`` helpers.
    """

    def __init__(self, ses_client=None):
        self._ses = ses_client

    def send(self, msg: EmailMessage) -> bool:
        """Send one email. Returns True if accepted by the provider.

        In dry-run mode (``settings.email_provider`` empty) we log and
        return True. Callers treat True as "provider accepted" - actual
        delivery is the provider's responsibility.
        """
        self._validate_v2_identity(msg)
        provider = (settings.email_provider or "").strip().lower()
        if not provider:
            log.info(
                "[email][dry-run] to=%s subject=%r idempotency_key=%s",
                msg.to,
                msg.subject,
                msg.idempotency_key,
            )
            return True

        if provider == "resend":
            return self._dispatch_resend(msg)
        if provider == "ses":
            return self._dispatch_ses(msg)

        raise NotImplementedError(
            f"email provider {provider!r} configured but dispatch is not wired yet"
        )

    def send_safely(self, msg: EmailMessage) -> bool:
        """Dispatch a background email and log provider failures."""
        try:
            return self.send(msg)
        except Exception:
            log.exception("Background email dispatch failed for subject=%r", msg.subject)
            return False

    @staticmethod
    def _validate_v2_identity(msg: EmailMessage) -> None:
        sender = settings.email_from.casefold()
        if "@wat2do.ca" in sender:
            raise RuntimeError("EMAIL_FROM must use wat2do.io, not wat2do.ca")
        if _LEGACY_WAT2DO_URL.search(msg.body_html) or _LEGACY_WAT2DO_URL.search(msg.body_text):
            raise RuntimeError("Outbound email links must use wat2do.io, not wat2do.ca")

    def _dispatch_resend(self, msg: EmailMessage) -> bool:
        api_key = settings.email_provider_api_key.strip()
        if not api_key:
            raise RuntimeError("EMAIL_PROVIDER_API_KEY is required when EMAIL_PROVIDER=resend")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if msg.idempotency_key:
            headers["Idempotency-Key"] = msg.idempotency_key

        payload = {
            "from": settings.email_from,
            "to": msg.to,
            "subject": msg.subject,
            "html": msg.body_html,
            "text": msg.body_text,
            "headers": msg.headers,
        }
        if msg.reply_to:
            payload["reply_to"] = msg.reply_to
        if msg.inline_images:
            payload["attachments"] = [
                {
                    "filename": image.filename,
                    "content": base64.b64encode(image.content).decode("ascii"),
                    "content_type": image.content_type,
                    "content_id": image.content_id,
                }
                for image in msg.inline_images
            ]

        response = httpx.post(
            RESEND_EMAILS_URL,
            json=payload,
            headers=headers,
            timeout=controlbox.email_delivery.provider_timeout_seconds,
        )
        response.raise_for_status()
        return True

    def _dispatch_ses(self, msg: EmailMessage) -> bool:
        # SES has no idempotency key; the notifications log claim already
        # guarantees one dispatch per (user, type, target).
        recipients = [msg.to] if isinstance(msg.to, str) else msg.to
        self._get_ses_client().send_email(
            Destination={"ToAddresses": recipients},
            Content={"Raw": {"Data": _mime_message(msg, recipients)}},
        )
        return True

    def _get_ses_client(self):
        if self._ses is None:
            timeout = controlbox.email_delivery.provider_timeout_seconds
            self._ses = boto3.client(
                "sesv2",
                region_name=settings.aws_region,
                config=Config(connect_timeout=timeout, read_timeout=timeout),
            )
        return self._ses


def _mime_message(msg: EmailMessage, recipients: list[str]) -> bytes:
    """Build the standard text/HTML alternative with inline images related to the HTML.

    Gmail and Outlook only resolve ``cid:`` images that sit in the HTML part's
    multipart/related container, so the message is assembled here rather than by SES.
    """
    mime = MimeMessage()
    mime["From"] = settings.email_from
    mime["To"] = ", ".join(recipients)
    mime["Subject"] = msg.subject
    if msg.reply_to:
        mime["Reply-To"] = msg.reply_to
    for name, value in msg.headers.items():
        mime[name] = value
    mime.set_content(msg.body_text)
    mime.add_alternative(msg.body_html, subtype="html")
    html_part = mime.get_payload()[1]
    for image in msg.inline_images:
        maintype, subtype = image.content_type.split("/", 1)
        html_part.add_related(
            image.content,
            maintype=maintype,
            subtype=subtype,
            cid=f"<{image.content_id}>",
            filename=image.filename,
            disposition="inline",
        )
    return mime.as_bytes()


email_service = EmailService()
