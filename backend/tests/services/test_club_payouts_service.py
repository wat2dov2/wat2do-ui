from unittest.mock import MagicMock

import pytest

from core.config import settings
from core.errors import CLUB_PENDING_REVIEW, PAYOUTS_NOT_READY
from core.exceptions import AuthorizationError, ValidationError
from schemas.club import ClubResponse
from services import club_payouts_service as module
from services.stripe_gateway import ConnectedAccount
from tests.conftest import make_db_user

MEMBER = make_db_user(email="officer@uwaterloo.ca")
CLUB = ClubResponse(id=7, club_name="Gala Club", school="uwaterloo")


def _account(**overrides) -> ConnectedAccount:
    data = {
        "id": "acct_7",
        "charges_enabled": False,
        "payouts_enabled": False,
        "details_submitted": False,
        "requirements_due": ["external_account"],
        **overrides,
    }
    return ConnectedAccount(**data)


@pytest.fixture
def payouts(monkeypatch, fake_sb, patch_sb):
    patch_sb("services.club_payouts_service")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_123")
    monkeypatch.setattr(module, "club_country", lambda club: "CA")
    return fake_sb


def test_the_first_onboarding_creates_the_clubs_one_account(payouts, monkeypatch):
    create = MagicMock(return_value=_account())
    link = MagicMock(return_value="https://connect.stripe.com/setup/e/1")
    monkeypatch.setattr(module.stripe_gateway, "create_express_account", create)
    monkeypatch.setattr(module.stripe_gateway, "onboarding_link", link)
    payouts.queue_responses([[], [{"club_id": 7, "stripe_account_id": "acct_7"}]])

    url = module.onboarding_url(CLUB, MEMBER)

    assert url == "https://connect.stripe.com/setup/e/1"
    assert create.call_args.kwargs["country"] == "CA"
    stored = payouts.upsert.call_args.args[0]
    assert stored["stripe_account_id"] == "acct_7" and stored["connected_by"] == str(MEMBER.id)
    assert payouts.upsert.call_args.kwargs == {"on_conflict": "club_id", "ignore_duplicates": True}
    assert link.call_args.kwargs["return_url"].endswith("/club-panel/payouts?onboarding=returned")


def test_returning_members_resume_the_same_account(payouts, monkeypatch):
    create = MagicMock()
    monkeypatch.setattr(module.stripe_gateway, "create_express_account", create)
    monkeypatch.setattr(module.stripe_gateway, "onboarding_link", MagicMock(return_value="u"))
    payouts.set_response(data=[{"club_id": 7, "stripe_account_id": "acct_7"}])

    module.onboarding_url(CLUB, MEMBER)

    create.assert_not_called()


def test_a_club_awaiting_review_cannot_take_payments():
    pending = CLUB.model_copy(update={"status": "pending"})
    with pytest.raises(AuthorizationError, match=CLUB_PENDING_REVIEW):
        module.onboarding_url(pending, MEMBER)


def test_status_refreshes_from_stripe_until_onboarding_is_finished(payouts, monkeypatch):
    stored = {
        "club_id": 7,
        "stripe_account_id": "acct_7",
        "charges_enabled": False,
        "payouts_enabled": False,
        "details_submitted": True,
        "requirements_due": ["external_account"],
    }
    ready = {**stored, "charges_enabled": True, "payouts_enabled": True, "requirements_due": []}
    monkeypatch.setattr(
        module.stripe_gateway,
        "retrieve_account",
        MagicMock(
            return_value=_account(charges_enabled=True, payouts_enabled=True, requirements_due=[])
        ),
    )
    payouts.queue_responses([[stored], [ready]])

    status = module.payout_status(CLUB)

    assert status.connected and status.charges_enabled and status.payouts_enabled
    assert status.currency == "cad" and status.requirements_due == []


def test_an_unconnected_club_reports_what_it_will_sell_in(payouts):
    payouts.set_response(data=[])
    status = module.payout_status(CLUB)
    assert status.connected is False and status.currency == "cad"


def test_selling_requires_stripe_to_accept_charges(payouts):
    payouts.set_response(data=[{"charges_enabled": False}])
    with pytest.raises(ValidationError, match=PAYOUTS_NOT_READY):
        module.require_charges_enabled(7)
