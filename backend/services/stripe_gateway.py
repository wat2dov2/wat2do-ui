"""The one place Wat2Do talks to Stripe.

Clubs are Stripe Connect Express accounts, and every charge is a direct charge on
the club's own account. Each call here therefore names that connected account
explicitly, so a checkout or a refund can only ever touch the right club's money.
Callers get plain values back, never Stripe objects.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import stripe

from core.config import settings
from core.errors import PAYMENT_PROVIDER_UNAVAILABLE, STRIPE_SIGNATURE_INVALID, TICKETING_DISABLED
from core.exceptions import AuthenticationError, ServiceError, ValidationError

log = logging.getLogger(__name__)

# Network retries Stripe's client makes on its own; each request is idempotent.
_MAX_NETWORK_RETRIES = 2


@dataclass(frozen=True)
class ConnectedAccount:
    id: str
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    requirements_due: list[str]


@dataclass(frozen=True)
class CheckoutSession:
    id: str
    url: str


@dataclass(frozen=True)
class StripeEvent:
    type: str
    # The connected account the event happened on; None for platform events.
    account: str | None
    object: dict[str, Any]


def _client() -> stripe.StripeClient:
    if not settings.stripe_secret_key:
        raise ValidationError(TICKETING_DISABLED)
    return _client_for(settings.stripe_secret_key)


@lru_cache(maxsize=1)
def _client_for(api_key: str) -> stripe.StripeClient:
    return stripe.StripeClient(api_key, max_network_retries=_MAX_NETWORK_RETRIES)


@contextmanager
def _stripe_call(action: str) -> Iterator[None]:
    """Log Stripe's own error for us and show the user one calm message."""
    try:
        yield
    except stripe.StripeError as exc:
        log.error(
            "Stripe %s failed: %s (request %s)", action, exc.user_message or exc, exc.request_id
        )
        raise ServiceError(PAYMENT_PROVIDER_UNAVAILABLE) from exc


def connected_account(account: dict[str, Any]) -> ConnectedAccount:
    """Read an account as returned by the API or carried by an ``account.updated`` event."""
    requirements = account.get("requirements") or {}
    due = [*(requirements.get("past_due") or []), *(requirements.get("currently_due") or [])]
    return ConnectedAccount(
        id=str(account["id"]),
        charges_enabled=bool(account.get("charges_enabled")),
        payouts_enabled=bool(account.get("payouts_enabled")),
        details_submitted=bool(account.get("details_submitted")),
        requirements_due=sorted(set(due)),
    )


def create_express_account(
    *, club_id: int, club_name: str, club_url: str, country: str, email: str | None
) -> ConnectedAccount:
    """A new Express account for one club; Stripe collects every requirement itself."""
    params: dict[str, Any] = {
        "controller": {
            "stripe_dashboard": {"type": "express"},
            "fees": {"payer": "application"},
            "losses": {"payments": "application"},
            "requirement_collection": "stripe",
        },
        "country": country,
        "capabilities": {"card_payments": {"requested": True}, "transfers": {"requested": True}},
        "business_profile": {
            "name": club_name,
            "url": club_url,
            "product_description": "Tickets to student club events sold on Wat2Do",
        },
        "metadata": {"club_id": str(club_id)},
    }
    if email:
        params["email"] = email
    with _stripe_call("account creation"):
        account = _client().v1.accounts.create(
            params,  # type: ignore[arg-type]
            options={"idempotency_key": f"club-account-{club_id}"},
        )
    return connected_account(account.to_dict())


def retrieve_account(account_id: str) -> ConnectedAccount:
    with _stripe_call("account retrieval"):
        account = _client().v1.accounts.retrieve(account_id)
    return connected_account(account.to_dict())


def onboarding_link(account_id: str, *, refresh_url: str, return_url: str) -> str:
    """Stripe's hosted onboarding, asking for everything up front so it is done once."""
    with _stripe_call("onboarding link"):
        link = _client().v1.account_links.create(
            {
                "account": account_id,
                "type": "account_onboarding",
                "refresh_url": refresh_url,
                "return_url": return_url,
                "collection_options": {"fields": "eventually_due"},
            }
        )
    return str(link.url)


def express_dashboard_link(account_id: str) -> str:
    with _stripe_call("dashboard link"):
        link = _client().v1.accounts.login_links.create(account_id)
    return str(link.url)


def create_checkout_session(
    account_id: str, params: dict[str, Any], *, idempotency_key: str
) -> CheckoutSession:
    with _stripe_call("checkout creation"):
        session = _client().v1.checkout.sessions.create(
            params,  # type: ignore[arg-type]
            options={"stripe_account": account_id, "idempotency_key": idempotency_key},
        )
    return CheckoutSession(id=str(session.id), url=str(session.url))


def refund(
    account_id: str,
    *,
    payment_intent_id: str,
    amount_cents: int,
    idempotency_key: str,
    metadata: dict[str, str],
) -> str:
    """Refund part of a club's payment; the same key never refunds twice."""
    with _stripe_call("refund"):
        created = _client().v1.refunds.create(
            {
                "payment_intent": payment_intent_id,
                "amount": amount_cents,
                "metadata": metadata,
            },
            options={"stripe_account": account_id, "idempotency_key": idempotency_key},
        )
    return str(created.id)


def verified_event(payload: bytes, signature: str | None) -> StripeEvent:
    """A Connect webhook event, only once its signature proves it came from Stripe."""
    if not settings.stripe_webhook_secret:
        raise ValidationError(TICKETING_DISABLED)
    try:
        event = _client().construct_event(payload, signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise AuthenticationError(STRIPE_SIGNATURE_INVALID) from exc
    data = event.to_dict()
    return StripeEvent(
        type=str(data["type"]),
        account=data.get("account"),
        object=dict(data["data"]["object"]),
    )
