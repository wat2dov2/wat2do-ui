from datetime import date, datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

from schemas.payout import AdminPayoutDetail, PosterPayoutResponse
from services import poster_payout_service
from tests.conftest import FAKE_USER

PAYOUT_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


def _payout(**overrides) -> PosterPayoutResponse:
    now = datetime.now(timezone.utc)
    defaults = {
        "id": PAYOUT_ID,
        "user_id": FAKE_USER["id"],
        "period": date(2026, 6, 1),
        "payout_email": "promoter@example.com",
        "rate_cents": 25,
        "amount_cents": 250,
        "scan_count": 10,
        "status": "pending",
        "paid_at": None,
        "notes": None,
        "reviewed_by": None,
        "created_at": now,
        "updated_at": now,
    }
    defaults.update(overrides)
    return PosterPayoutResponse.model_validate(defaults)


def test_list_own_payouts_requires_auth(client):
    response = client.get("/payouts/")
    assert response.status_code == 401


def test_list_own_payouts_is_scoped_to_user(authenticated_client, monkeypatch):
    listing = MagicMock(return_value=([_payout()], 1))
    monkeypatch.setattr(poster_payout_service, "list_user_payouts", listing)

    response = authenticated_client.get("/payouts/")

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert "notes" not in response.json()["items"][0]
    assert "reviewed_by" not in response.json()["items"][0]
    assert listing.call_args.args[0] == FAKE_USER["id"]


def test_admin_listing_rejects_non_admin(authenticated_client):
    response = authenticated_client.get("/payouts/admin")
    assert response.status_code == 403


def test_admin_can_list_and_filter_payouts(admin_client, monkeypatch):
    listing = MagicMock(return_value=([_payout()], 1))
    monkeypatch.setattr(poster_payout_service, "list_admin_payouts", listing)

    response = admin_client.get(
        "/payouts/admin",
        params={"period": "2026-06-01", "payout_status": "pending"},
    )

    assert response.status_code == 200
    assert listing.call_args.kwargs["period"] == date(2026, 6, 1)
    assert listing.call_args.kwargs["status"] == "pending"


def test_admin_transition_delegates_validated_action(admin_client, monkeypatch):
    transition = MagicMock(return_value=_payout(status="held", notes="Review required"))
    monkeypatch.setattr(poster_payout_service, "transition_payout", transition)

    response = admin_client.patch(
        f"/payouts/admin/{PAYOUT_ID}/status",
        json={"status": "held", "notes": "Review required"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "held"
    assert transition.call_args.kwargs["target_status"] == "held"


def test_admin_can_bulk_mark_paid(admin_client, monkeypatch):
    paid = _payout(status="paid", paid_at=datetime.now(timezone.utc))
    bulk = MagicMock(return_value=[paid])
    monkeypatch.setattr(poster_payout_service, "bulk_mark_paid", bulk)

    response = admin_client.post(
        "/payouts/admin/mark-paid",
        json={"payout_ids": [str(PAYOUT_ID)]},
    )

    assert response.status_code == 200
    assert response.json()[0]["status"] == "paid"


def test_admin_detail_returns_fraud_summary(admin_client, monkeypatch):
    detail = AdminPayoutDetail(payout=_payout(), fraud_reasons=[])
    get_detail = MagicMock(return_value=detail)
    monkeypatch.setattr(poster_payout_service, "get_admin_payout_detail", get_detail)

    response = admin_client.get(f"/payouts/admin/{PAYOUT_ID}")

    assert response.status_code == 200
    assert response.json()["payout"]["id"] == str(PAYOUT_ID)
