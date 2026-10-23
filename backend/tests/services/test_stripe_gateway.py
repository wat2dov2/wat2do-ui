import json
import time
from unittest.mock import MagicMock

import pytest
import stripe

from core.config import settings
from core.errors import PAYMENT_PROVIDER_UNAVAILABLE, STRIPE_SIGNATURE_INVALID, TICKETING_DISABLED
from core.exceptions import AuthenticationError, ServiceError, ValidationError
from services import stripe_gateway as module

SECRET = "whsec_test_secret"


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)


@pytest.fixture
def client(monkeypatch, keys):
    fake = MagicMock()
    monkeypatch.setattr(module, "_client", lambda: fake)
    return fake.v1


def _signed(payload: dict) -> tuple[bytes, str]:
    body = json.dumps(payload).encode()
    timestamp = int(time.time())
    signature = stripe.WebhookSignature._compute_signature(f"{timestamp}.{body.decode()}", SECRET)
    return body, f"t={timestamp},v1={signature}"


def test_without_a_secret_key_nothing_reaches_stripe(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    with pytest.raises(ValidationError, match=TICKETING_DISABLED):
        module.retrieve_account("acct_1")


def test_a_club_account_is_an_express_account_created_once(client):
    client.accounts.create.return_value.to_dict.return_value = {"id": "acct_new"}

    account = module.create_express_account(
        club_id=7, club_name="Gala Club", club_url="https://x/clubs/7", country="CA", email="o@x.ca"
    )

    params = client.accounts.create.call_args.args[0]
    assert params["controller"]["stripe_dashboard"] == {"type": "express"}
    assert params["country"] == "CA" and params["email"] == "o@x.ca"
    assert client.accounts.create.call_args.kwargs["options"] == {
        "idempotency_key": "club-account-7"
    }
    assert account.id == "acct_new" and account.charges_enabled is False


def test_an_account_reports_every_requirement_stripe_still_needs():
    account = module.connected_account(
        {
            "id": "acct_1",
            "charges_enabled": True,
            "payouts_enabled": False,
            "details_submitted": True,
            "requirements": {"currently_due": ["external_account"], "past_due": ["tos"]},
        }
    )
    assert account.requirements_due == ["external_account", "tos"]


def test_checkout_and_refunds_run_on_the_clubs_own_account(client):
    client.checkout.sessions.create.return_value = MagicMock(id="cs_1", url="https://pay")
    client.refunds.create.return_value = MagicMock(id="re_1")

    session = module.create_checkout_session("acct_club", {"mode": "payment"}, idempotency_key="k1")
    refund_id = module.refund(
        "acct_club", payment_intent_id="pi_1", amount_cents=500, idempotency_key="k2", metadata={}
    )

    assert session.url == "https://pay" and refund_id == "re_1"
    assert client.checkout.sessions.create.call_args.kwargs["options"] == {
        "stripe_account": "acct_club",
        "idempotency_key": "k1",
    }
    assert client.refunds.create.call_args.args[0]["amount"] == 500
    assert client.refunds.create.call_args.kwargs["options"]["stripe_account"] == "acct_club"


def test_a_stripe_outage_becomes_one_calm_message(client):
    client.accounts.retrieve.side_effect = stripe.APIConnectionError("network down")
    with pytest.raises(ServiceError, match=PAYMENT_PROVIDER_UNAVAILABLE):
        module.retrieve_account("acct_1")


def test_a_webhook_is_trusted_only_with_stripes_signature(keys):
    body, signature = _signed(
        {
            "id": "evt_1",
            "object": "event",
            "type": "checkout.session.completed",
            "account": "acct_club",
            "data": {"object": {"id": "cs_1", "client_reference_id": "o1"}},
        }
    )

    event = module.verified_event(body, signature)

    assert event.type == "checkout.session.completed"
    assert event.account == "acct_club"
    assert event.object["client_reference_id"] == "o1"
    with pytest.raises(AuthenticationError, match=STRIPE_SIGNATURE_INVALID):
        module.verified_event(body, "t=1,v1=forged")
    with pytest.raises(AuthenticationError, match=STRIPE_SIGNATURE_INVALID):
        module.verified_event(body.replace(b"o1", b"o2"), signature)


def test_webhooks_fail_closed_without_a_signing_secret(monkeypatch, keys):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    with pytest.raises(ValidationError, match=TICKETING_DISABLED):
        module.verified_event(b"{}", "t=1,v1=x")
