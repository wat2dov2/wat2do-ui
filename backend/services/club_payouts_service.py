"""Connecting a club's Stripe Express account so the club can sell tickets.

Each club has at most one account, created the first time a member starts
onboarding. The app never replaces it, so no member can redirect a club's
payouts; only Stripe's own onboarding collects bank and identity details.
"""

from __future__ import annotations

import logging
from typing import Any

from core.config import settings
from core.controlbox import TicketCountry, controlbox
from core.database import get_sb
from core.errors import CLUB_PENDING_REVIEW, PAYOUTS_NOT_READY
from core.exceptions import AuthorizationError, ValidationError
from core.tables import CLUB_PAYMENT_ACCOUNTS
from schemas.club import CLUB_STATUS_APPROVED, ClubResponse
from schemas.ticketing import ClubPayoutStatus
from schemas.user import UserResponse
from services import school_service, stripe_gateway
from services.school_context import school_frontend_url

log = logging.getLogger(__name__)

CONTROL = controlbox.ticketing
# Where Stripe sends a member back after onboarding, inside the club panel.
PAYOUTS_PATH = "/club-panel/payouts"


def club_country(club: ClubResponse) -> TicketCountry:
    school = school_service.get_school(club.school)
    return school.country if school is not None else "CA"


def get_payment_account(club_id: int) -> dict[str, Any] | None:
    response = (
        get_sb().table(CLUB_PAYMENT_ACCOUNTS).select("*").eq("club_id", club_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def require_charges_enabled(club_id: int) -> dict[str, Any]:
    """The club's account, once Stripe lets it take payments."""
    account = get_payment_account(club_id)
    if account is None or not account["charges_enabled"]:
        raise ValidationError(PAYOUTS_NOT_READY)
    return account


def payout_status(club: ClubResponse) -> ClubPayoutStatus:
    """The club's payout state, refreshed from Stripe while onboarding is unfinished."""
    country = club_country(club)
    account = get_payment_account(club.id)
    if account is not None and _onboarding_unfinished(account) and _stripe_configured():
        account = _store_account(stripe_gateway.retrieve_account(account["stripe_account_id"]))
    return ClubPayoutStatus(
        ticketing_enabled=CONTROL.enabled and _stripe_configured(),
        connected=account is not None,
        charges_enabled=bool(account and account["charges_enabled"]),
        payouts_enabled=bool(account and account["payouts_enabled"]),
        details_submitted=bool(account and account["details_submitted"]),
        requirements_due=list(account["requirements_due"]) if account else [],
        country=country,
        currency=CONTROL.currency_by_country[country],
    )


def onboarding_url(club: ClubResponse, member: UserResponse) -> str:
    """Stripe's hosted onboarding for the club, creating its account on first use."""
    if club.status != CLUB_STATUS_APPROVED:
        raise AuthorizationError(CLUB_PENDING_REVIEW)
    account = get_payment_account(club.id)
    if account is None:
        account = _connect_new_account(club, member)
    panel_url = f"{school_frontend_url(club.school)}{PAYOUTS_PATH}"
    return stripe_gateway.onboarding_link(
        account["stripe_account_id"],
        refresh_url=f"{panel_url}?onboarding=refresh",
        return_url=f"{panel_url}?onboarding=returned",
    )


def dashboard_url(club: ClubResponse) -> str:
    """A one-time login to the club's Stripe Express dashboard for payouts and balances."""
    account = get_payment_account(club.id)
    if account is None or not account["details_submitted"]:
        raise ValidationError(PAYOUTS_NOT_READY)
    return stripe_gateway.express_dashboard_link(account["stripe_account_id"])


def sync_account(account: stripe_gateway.ConnectedAccount) -> None:
    """Apply Stripe's latest view of an account, as an ``account.updated`` event reports it."""
    if _store_account(account) is None:
        log.warning("Stripe reported an account Wat2Do does not know: %s", account.id)


def _connect_new_account(club: ClubResponse, member: UserResponse) -> dict[str, Any]:
    country = club_country(club)
    created = stripe_gateway.create_express_account(
        club_id=club.id,
        club_name=club.club_name,
        club_url=f"{school_frontend_url(club.school)}/clubs/{club.id}",
        country=country,
        email=member.email,
    )
    response = (
        get_sb()
        .table(CLUB_PAYMENT_ACCOUNTS)
        .upsert(
            {
                "club_id": club.id,
                "stripe_account_id": created.id,
                "country": country,
                "charges_enabled": created.charges_enabled,
                "payouts_enabled": created.payouts_enabled,
                "details_submitted": created.details_submitted,
                "requirements_due": created.requirements_due,
                "connected_by": str(member.id),
            },
            on_conflict="club_id",
            ignore_duplicates=True,
        )
        .execute()
    )
    # Two members starting at once share Stripe's idempotent account; the first row wins.
    stored = response.data[0] if response.data else get_payment_account(club.id)
    if stored is None:
        raise RuntimeError(f"Payment account for club {club.id} was not stored")
    return stored


def _store_account(account: stripe_gateway.ConnectedAccount) -> dict[str, Any] | None:
    response = (
        get_sb()
        .table(CLUB_PAYMENT_ACCOUNTS)
        .update(
            {
                "charges_enabled": account.charges_enabled,
                "payouts_enabled": account.payouts_enabled,
                "details_submitted": account.details_submitted,
                "requirements_due": account.requirements_due,
            }
        )
        .eq("stripe_account_id", account.id)
        .execute()
    )
    return response.data[0] if response.data else None


def _onboarding_unfinished(account: dict[str, Any]) -> bool:
    return not (account["charges_enabled"] and account["payouts_enabled"]) or bool(
        account["requirements_due"]
    )


def _stripe_configured() -> bool:
    return bool(settings.stripe_secret_key and settings.stripe_webhook_secret)
