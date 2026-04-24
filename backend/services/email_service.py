"""Email-sending gateway for the notifications feature.

Class-based because it wraps an external client (per the layered
architecture convention — see backend-architecture.md). The module-level
singleton ``email_service`` is what callers import; tests monkeypatch
the instance directly.

v1 is DRY-RUN by default: if no ``EMAIL_PROVIDER`` is set in settings,
``send()`` logs the message and returns success without dispatching. That
lets the rest of the notifications pipeline (enqueue, dedup, log writes,
cron composition) run end-to-end locally and in CI without a provider
API key. Flipping the provider on is a config change plus one new branch
in ``send()`` — no call-site changes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from core.config import settings

log = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    to: str
    subject: str
    body_html: str
    body_text: str
    # Stable per-send key — the provider (when configured) uses it for
    # its own idempotency; inside our own log the (user, type, target, channel)
    # UNIQUE constraint already protects us, so this is purely belt-and-
    # suspenders in case a cron restart re-hits the provider before our
    # ``UPDATE status='sent'`` commits.
    idempotency_key: str | None = None


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
        return True. Callers treat True as "provider accepted" — actual
        delivery is the provider's responsibility.
        """
        provider = (settings.email_provider or "").strip().lower()
        if not provider:
            log.info(
                "[email][dry-run] to=%s subject=%r idempotency_key=%s",
                msg.to,
                msg.subject,
                msg.idempotency_key,
            )
            return True

        # v2 flip: replace this branch with provider-specific dispatch.
        # Keeping the raise here so a half-configured deploy fails loud
        # instead of silently dropping mail.
        raise NotImplementedError(
            f"email provider {provider!r} configured but dispatch is not wired yet"
        )


email_service = EmailService()
