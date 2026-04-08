from datetime import datetime, timezone
from unittest.mock import MagicMock

from core.constants import MAX_CREDITS_PER_ADD
from schemas.credit import PromotionResponse
from schemas.user import UserResponse
from services import credit_service, user_service
from tests.conftest import FAKE_USER

TARGET_USER_ID = "00000000-0000-0000-0000-000000000001"


def _mock_db_user(**overrides) -> UserResponse:
    defaults = {
        "id": TARGET_USER_ID,
        "email": FAKE_USER["email"],
        "username": "testuser",
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


def _mock_promotion(**overrides) -> PromotionResponse:
    defaults = {
        "id": "promo-1",
        "user_id": TARGET_USER_ID,
        "event_id": 1,
        "package": "featured",
        "credits_spent": 50,
        "start_date": "2026-04-01T00:00:00Z",
        "end_date": "2026-04-08T00:00:00Z",
        "created_at": "2026-04-01T00:00:00Z",
    }
    defaults.update(overrides)
    return PromotionResponse.model_validate(defaults)


# ── GET /credits/ ────────────────────────────────────────────────────


def test_get_credits_requires_auth(client):
    response = client.get("/credits/")
    assert response.status_code == 401


def test_get_credits_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(credit_service, "get_balance", MagicMock(return_value=42))

    resp = authenticated_client.get("/credits/")
    assert resp.status_code == 200
    assert resp.json()["balance"] == 42


# ── POST /credits/add (admin-only) ─────────────────────────────────


def test_add_credits_requires_auth(client):
    response = client.post("/credits/add", json={"user_id": TARGET_USER_ID, "amount": 10})
    assert response.status_code == 401


def test_add_credits_forbidden_for_regular_user(authenticated_client):
    """Non-admin authenticated users must get 403."""
    resp = authenticated_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": 10},
    )
    assert resp.status_code == 403


def test_add_credits_succeeds_for_admin(admin_client, monkeypatch):
    monkeypatch.setattr(credit_service, "add_credits", MagicMock(return_value=52))

    resp = admin_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": 10},
    )
    assert resp.status_code == 200
    assert resp.json()["balance"] == 52
    credit_service.add_credits.assert_called_once_with(TARGET_USER_ID, 10)


def test_add_credits_rejects_zero_amount(admin_client):
    resp = admin_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": 0},
    )
    assert resp.status_code == 422


def test_add_credits_rejects_negative_amount(admin_client):
    resp = admin_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": -5},
    )
    assert resp.status_code == 422


def test_add_credits_rejects_amount_over_max(admin_client):
    resp = admin_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": MAX_CREDITS_PER_ADD + 1},
    )
    assert resp.status_code == 422


def test_add_credits_accepts_max_amount(admin_client, monkeypatch):
    monkeypatch.setattr(credit_service, "add_credits", MagicMock(return_value=MAX_CREDITS_PER_ADD))

    resp = admin_client.post(
        "/credits/add",
        json={"user_id": TARGET_USER_ID, "amount": MAX_CREDITS_PER_ADD},
    )
    assert resp.status_code == 200


def test_add_credits_requires_user_id(admin_client):
    """Missing user_id should fail validation."""
    resp = admin_client.post("/credits/add", json={"amount": 10})
    assert resp.status_code == 422


# ── GET /promotions/ ────────────────────────────────────────────────


def test_list_promotions_requires_auth(client):
    response = client.get("/promotions/")
    assert response.status_code == 401


def test_list_promotions_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    promo = _mock_promotion()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(credit_service, "get_user_promotions", MagicMock(return_value=[promo]))

    resp = authenticated_client.get("/promotions/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["package"] == "featured"


# ── POST /promotions/ ───────────────────────────────────────────────


def test_create_promotion_requires_auth(client):
    response = client.post(
        "/promotions/",
        json={"event_id": 1, "package": "featured"},
    )
    assert response.status_code == 401


def test_create_promotion_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    promo = _mock_promotion()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(credit_service, "create_promotion", MagicMock(return_value=promo))

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1, "package": "featured"},
    )
    assert resp.status_code == 201
    assert resp.json()["event_id"] == 1
    # Server determines cost/duration — only event_id and package are forwarded
    credit_service.create_promotion.assert_called_once_with(
        user_id=str(db_user.id),
        event_id=1,
        package="featured",
    )


def test_create_promotion_ignores_client_credits_and_duration(authenticated_client, monkeypatch):
    """Even if a malicious client sends credits/duration, the server ignores them."""
    db_user = _mock_db_user()
    promo = _mock_promotion()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(credit_service, "create_promotion", MagicMock(return_value=promo))

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1, "package": "featured", "credits": 1, "duration": 36500},
    )
    assert resp.status_code == 201
    # The service is called without the attacker-controlled values
    credit_service.create_promotion.assert_called_once_with(
        user_id=str(db_user.id),
        event_id=1,
        package="featured",
    )


def test_create_promotion_rejects_invalid_package(authenticated_client, monkeypatch):
    """Server rejects package names not in the Literal type."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1, "package": "nonexistent"},
    )
    assert resp.status_code == 422


# ── GET /promotions/active-ids (public) ──────────────────────────────


def test_active_promoted_ids_public(client, monkeypatch):
    """This endpoint requires no auth — it returns active promotion IDs publicly."""
    monkeypatch.setattr(credit_service, "get_active_promoted_event_ids", MagicMock(return_value=[1, 5, 9]))

    resp = client.get("/promotions/active-ids")
    assert resp.status_code == 200
    assert resp.json() == [1, 5, 9]
