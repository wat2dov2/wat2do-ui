from datetime import datetime, timezone
from unittest.mock import MagicMock

from core.constants import MAX_CREDITS_PER_ADD, ROLE_ADMIN
from schemas.credit import PromotionResponse
from schemas.event import EventResponse
from schemas.user import UserResponse
from services import credit_service, event_service, organization_service, user_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER

TARGET_USER_ID = "00000000-0000-0000-0000-000000000001"


def _mock_db_user(**overrides) -> UserResponse:
    defaults = {
        # Default id matches FAKE_USER["id"] so ownership checks pass
        # when the test mocks an event with ``created_by=FAKE_USER["id"]``.
        "id": FAKE_USER["id"],
        "email": FAKE_USER["email"],
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


def _mock_event(**overrides) -> EventResponse:
    defaults = {
        "id": 1,
        "organization_id": 1,
        "title": "Test Event",
        "location": "Here",
        "organization": "TestOrg",
        "added_at": datetime.now(timezone.utc),
        "created_by": FAKE_USER["id"],
        "occurrences": [
            {
                "id": 1,
                "event_id": 1,
                "dtstart_utc": datetime(2026, 7, 1, 17, 0, tzinfo=timezone.utc),
                "dtend_utc": datetime(2026, 7, 1, 18, 0, tzinfo=timezone.utc),
                "created_at": datetime.now(timezone.utc),
            }
        ],
    }
    defaults.update(overrides)
    return EventResponse.model_validate(defaults)


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


def test_add_credits_rejects_malformed_uuid(admin_client):
    """C13: user_id must be a valid UUID; malformed strings fail at Pydantic."""
    resp = admin_client.post(
        "/credits/add",
        json={"user_id": "not-a-uuid", "amount": 10},
    )
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


def test_list_promotions_forwards_pagination_and_active_filter(authenticated_client, monkeypatch):
    """C14: active/limit/offset query params are forwarded to the service."""
    db_user = _mock_db_user()
    mock_get = MagicMock(return_value=[])
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(credit_service, "get_user_promotions", mock_get)

    resp = authenticated_client.get("/promotions/?active=true&limit=25&offset=50")
    assert resp.status_code == 200
    mock_get.assert_called_once_with(
        str(db_user.id),
        active=True,
        limit=25,
        offset=50,
    )


# ── POST /promotions/ ───────────────────────────────────────────────


def test_create_promotion_requires_auth(client):
    response = client.post(
        "/promotions/",
        json={"event_id": 1},
    )
    assert response.status_code == 401


def test_create_promotion_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    promo = _mock_promotion()
    event = _mock_event(created_by=OTHER_USER["id"], organization="TestOrg")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(credit_service, "create_promotion", MagicMock(return_value=promo))

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1},
    )
    assert resp.status_code == 201
    assert resp.json()["event_id"] == 1
    organization_service.is_organization_member.assert_called_once_with(1, str(db_user.id))
    credit_service.create_promotion.assert_called_once_with(
        user_id=str(db_user.id),
        event_id=1,
    )


def test_create_promotion_rejects_package_credits_and_duration(authenticated_client):
    """Promotion creation accepts only the current fixed-package payload."""

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1, "package": "combo", "credits": 1, "duration": 36500},
    )
    assert resp.status_code == 422


# ── POST /promotions/ ownership checks ──────────────────────────────


def test_create_promotion_rejects_nonexistent_event(authenticated_client, monkeypatch):
    """Promoting a nonexistent event returns 404."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=None))

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 999},
    )
    assert resp.status_code == 404


def test_create_promotion_non_organization_owner_rejected(other_user_client, monkeypatch):
    """Non-admin users can only promote events attached to their own organization."""
    db_user = _mock_db_user(id="00000000-0000-0000-0000-000000000002")
    event = _mock_event(created_by=FAKE_USER["id"], organization="TestOrg")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    resp = other_user_client.post(
        "/promotions/",
        json={"event_id": 1},
    )
    assert resp.status_code == 403


def test_create_promotion_admin_can_promote_any_event(admin_client, monkeypatch):
    """Admin can promote any event regardless of ownership."""
    promo = _mock_promotion()
    event = _mock_event(created_by=FAKE_USER["id"])  # not owned by admin
    admin_db_user = UserResponse(
        id="00000000-0000-0000-0000-000000000000",
        email=ADMIN_USER["email"],
        role=ROLE_ADMIN,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(
        user_service, "get_user_by_supabase_id", MagicMock(return_value=admin_db_user)
    )
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(credit_service, "create_promotion", MagicMock(return_value=promo))

    resp = admin_client.post(
        "/promotions/",
        json={"event_id": 1},
    )
    assert resp.status_code == 201


def test_create_promotion_event_without_matching_organization_rejected(
    authenticated_client, monkeypatch
):
    """A user owning the event row is not enough; the event must belong to their organization."""
    db_user = _mock_db_user()
    event = _mock_event(created_by=FAKE_USER["id"], organization="Other Organization")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=event))
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    resp = authenticated_client.post(
        "/promotions/",
        json={"event_id": 1},
    )
    assert resp.status_code == 403


# ── GET /promotions/active-ids (public) ──────────────────────────────


def test_active_promoted_ids_public(client, monkeypatch):
    """This endpoint requires no auth — it returns active promotion IDs publicly."""
    monkeypatch.setattr(
        credit_service, "get_active_promoted_event_ids", MagicMock(return_value=[1, 5, 9])
    )

    resp = client.get("/promotions/active-ids")
    assert resp.status_code == 200
    assert resp.json() == [1, 5, 9]
