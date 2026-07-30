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

import logging
import re
from dataclasses import dataclass, field

import httpx

from core.config import settings
from core.controlbox import controlbox

log = logging.getLogger(__name__)

RESEND_EMAILS_URL = "https://api.resend.com/emails"
_LEGACY_WAT2DO_URL = re.compile(
    r"https?://(?:[a-z0-9-]+\.)*wat2do\.ca(?=[:/?#\s\"'<]|$)",
    re.IGNORECASE,
)


@dataclass
class EmailMessage:
    to: str
    subject: str
    body_html: str
    body_text: str
    # Stable per-send key - the provider (when configured) uses it for
    # its own idempotency; inside our own log the (user, type, target, channel)
    # UNIQUE constraint already protects us, so this is purely belt-and-
    # suspenders in case a cron restart re-hits the provider before our
    # ``UPDATE status='sent'`` commits.
    idempotency_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


class EmailService:
    """Thin wrapper around the outbound email provider.

    Methods intentionally take an ``EmailMessage`` rather than positional
    ``to/subject/...`` so the call site is a single stable signature
    across providers. Provider-specific headers (reply-to, sender domain)
    get set inside ``_dispatch_*`` helpers.
    """

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

        raise NotImplementedError(
            f"email provider {provider!r} configured but dispatch is not wired yet"
        )

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

        response = httpx.post(
            RESEND_EMAILS_URL,
            json={
                "from": settings.email_from,
                "to": msg.to,
                "subject": msg.subject,
                "html": msg.body_html,
                "text": msg.body_text,
                "headers": msg.headers,
            },
            headers=headers,
            timeout=controlbox.email_delivery.provider_timeout_seconds,
        )
        response.raise_for_status()
        return True


email_service = EmailService()
