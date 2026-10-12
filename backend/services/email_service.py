"""Email-sending gateway for transactional app email.

Class-based because it wraps an external client (per the layered
architecture convention - see backend-architecture.md). The module-level
singleton ``email_service`` is what callers import; tests monkeypatch
the instance directly.

Mail goes out through Amazon SES. DRY-RUN by default: unless
``EMAIL_DELIVERY_ENABLED`` is set, ``send()`` logs the message and returns
success without dispatching. That lets the rest of the notifications pipeline
(enqueue, dedup, log writes, cron composition) run end-to-end in CI without
AWS credentials.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from email.message import EmailMessage as MimeMessage

import boto3  # type: ignore[import-untyped]
from botocore.config import Config  # type: ignore[import-untyped]

from core.config import settings
from core.controlbox import controlbox

log = logging.getLogger(__name__)

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
    # Stable per-send key, logged so a dispatch can be traced to its
    # notifications log row. SES has no idempotency key; the log's
    # (user, type, target, channel) UNIQUE claim guarantees one dispatch.
    idempotency_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    inline_images: list[InlineImage] = field(default_factory=list)


class EmailService:
    """Thin wrapper around Amazon SES.

    Methods take an ``EmailMessage`` rather than positional
    ``to/subject/...`` so every caller shares one stable signature.
    """

    def __init__(self, ses_client=None):
        self._ses = ses_client

    def send(self, msg: EmailMessage) -> bool:
        """Send one email. Returns True once SES accepts it.

        In dry-run mode (``settings.email_delivery_enabled`` false) we log
        and return True. Actual delivery is SES's responsibility.
        """
        self._validate_v2_identity(msg)
        if not settings.email_delivery_enabled:
            log.info(
                "[email][dry-run] to=%s subject=%r idempotency_key=%s",
                msg.to,
                msg.subject,
                msg.idempotency_key,
            )
            return True
        recipients = [msg.to] if isinstance(msg.to, str) else msg.to
        self._get_ses_client().send_email(
            Destination={"ToAddresses": recipients},
            Content={"Raw": {"Data": _mime_message(msg, recipients)}},
        )
        return True

    def send_safely(self, msg: EmailMessage) -> bool:
        """Dispatch a background email and log SES failures."""
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
