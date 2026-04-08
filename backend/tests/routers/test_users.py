from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.user import UserResponse
from services import user_service
from tests.conftest import FAKE_USER


def _mock_user(**overrides) -> UserResponse:
    defaults = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": FAKE_USER["email"],
        "username": "testuser",
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /users/me ───────────────────────────────────────────────────


def test_get_me_requires_auth(client):
    response = client.get("/users/me")
    assert response.status_code == 401


def test_get_me_returns_user(authenticated_client, monkeypatch):
    user = _mock_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=user))

    resp = authenticated_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == FAKE_USER["email"]


# ── PATCH /users/me ─────────────────────────────────────────────────


def test_update_me_requires_auth(client):
    response = client.patch("/users/me", json={"username": "new"})
    assert response.status_code == 401


def test_update_me_succeeds(authenticated_client, monkeypatch):
    user = _mock_user()
    updated = _mock_user(username="newname")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=user))
    monkeypatch.setattr(user_service, "update_user", MagicMock(return_value=updated))

    resp = authenticated_client.patch("/users/me", json={"username": "newname"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "newname"


# ── PATCH /users/me/profile ─────────────────────────────────────────


def test_update_profile_requires_auth(client):
    response = client.patch("/users/me/profile", json={"faculty": "Engineering"})
    assert response.status_code == 401


def test_update_profile_succeeds(authenticated_client, monkeypatch):
    user = _mock_user()
    updated = _mock_user(faculty="Engineering")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=user))
    monkeypatch.setattr(user_service, "update_user", MagicMock(return_value=updated))

    resp = authenticated_client.patch("/users/me/profile", json={"faculty": "Engineering"})
    assert resp.status_code == 200


# ── GET /users/ (admin-only) ────────────────────────────────────────


def test_list_users_requires_auth(client):
    response = client.get("/users/")
    assert response.status_code == 401


def test_list_users_forbidden_for_non_admin(authenticated_client):
    """Non-admin authenticated user gets 403 on admin-only list endpoint."""
    resp = authenticated_client.get("/users/")
    assert resp.status_code == 403


# ── GET /users/{user_id} (admin-only) ───────────────────────────────


def test_get_user_requires_auth(client):
    response = client.get("/users/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 401


def test_get_user_forbidden_for_non_admin(authenticated_client):
    """Non-admin authenticated user gets 403 on admin-only get endpoint."""
    resp = authenticated_client.get("/users/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 403


# ── DELETE /users/{user_id} (admin-only) ─────────────────────────────


def test_delete_user_requires_auth(client):
    response = client.delete("/users/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 401


def test_delete_user_forbidden_for_non_admin(authenticated_client):
    """Non-admin authenticated user gets 403 on admin-only delete endpoint."""
    resp = authenticated_client.delete("/users/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 403


# ── Health check ─────────────────────────────────────────────────────


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
