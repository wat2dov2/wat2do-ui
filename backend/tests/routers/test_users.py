import io
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from core import auth
from schemas.user import UserResponse
from services import user_service
from tests.conftest import FAKE_USER


def _mock_user(**overrides) -> UserResponse:
    defaults = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": FAKE_USER["email"],
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /users/me ───────────────────────────────────────────────────


def test_session_survives_worker_restart_and_signing_key_outage(client, monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update(kid="test-signing-key", use="sig", alg="ES256")
    keys_available = True
    fetch_count = 0

    def fetch_keys(*args, **kwargs):
        nonlocal fetch_count
        fetch_count += 1
        if not keys_available:
            raise TimeoutError("Simulated signing-key outage")
        return io.BytesIO(json.dumps({"keys": [public_jwk]}).encode())

    monkeypatch.setattr("jwt.jwks_client.urllib.request.urlopen", fetch_keys)
    monkeypatch.setattr(auth, "_jwks_client", None)
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", lambda _: _mock_user())
    claims = {
        "sub": FAKE_USER["id"],
        "email": FAKE_USER["email"],
        "aud": "authenticated",
        "iss": auth._EXPECTED_ISSUER,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": public_jwk["kid"]})
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/users/me", headers=headers).status_code == 200
    keys_available = False
    # A warm worker keeps verifying the exact same token from its cached key.
    assert client.get("/users/me", headers=headers).status_code == 200
    assert fetch_count == 1

    # A deployment replaces that worker and its in-memory signing-key cache.
    monkeypatch.setattr(auth, "_jwks_client", None)
    assert client.get("/users/me", headers=headers).status_code == 503
    assert fetch_count == 2

    keys_available = True
    recovered = client.get("/users/me", headers=headers)
    assert recovered.status_code == 200
    assert recovered.json()["email"] == FAKE_USER["email"]
    assert fetch_count == 3

    # Availability handling must not admit an actually expired session.
    claims["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    expired = jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": public_jwk["kid"]})
    assert (
        client.get("/users/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    )


def test_get_me_requires_auth(client):
    response = client.get("/users/me")
    assert response.status_code == 401


def test_get_me_returns_user(authenticated_client, monkeypatch):
    user = _mock_user()
    get_user_by_supabase_id = MagicMock(return_value=user)
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", get_user_by_supabase_id)

    resp = authenticated_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == FAKE_USER["email"]
    get_user_by_supabase_id.assert_called_once_with(FAKE_USER["id"])


# ── PATCH /users/me ─────────────────────────────────────────────────


def test_update_me_requires_auth(client):
    response = client.patch("/users/me", json={"full_name": "new"})
    assert response.status_code == 401


def test_update_me_succeeds(authenticated_client, monkeypatch):
    user = _mock_user()
    updated = _mock_user(full_name="newname")
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=user))
    monkeypatch.setattr(user_service, "update_user", MagicMock(return_value=updated))

    resp = authenticated_client.patch("/users/me", json={"full_name": "newname"})
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "newname"


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


# ── PUT /users/me/promoter-enrollment ──────────────────────────────


def test_promoter_enrollment_requires_auth(client):
    response = client.put(
        "/users/me/promoter-enrollment",
        json={"payout_email": "promoter@example.com", "accept_tos": True},
    )
    assert response.status_code == 401


def test_promoter_enrollment_succeeds(authenticated_client, monkeypatch):
    enrolled = _mock_user(
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=datetime.now(timezone.utc),
        promoter_tos_version="2026-07",
    )
    update = MagicMock(return_value=enrolled)
    monkeypatch.setattr(user_service, "update_promoter_enrollment", update)

    response = authenticated_client.put(
        "/users/me/promoter-enrollment",
        json={"payout_email": "promoter@example.com", "accept_tos": True},
    )

    assert response.status_code == 200
    assert response.json()["payout_email"] == "promoter@example.com"
    assert response.json()["promoter_tos_version"] == "2026-07"
    update.assert_called_once()


def test_promoter_enrollment_rejects_invalid_email(authenticated_client):
    response = authenticated_client.put(
        "/users/me/promoter-enrollment",
        json={"payout_email": "not-an-email", "accept_tos": True},
    )
    assert response.status_code == 422


def test_promoter_enrollment_rejects_csv_formula_email(authenticated_client):
    response = authenticated_client.put(
        "/users/me/promoter-enrollment",
        json={"payout_email": "=cmd@example.com", "accept_tos": True},
    )
    assert response.status_code == 422


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


def test_delete_user_admin_deletes_other_user(admin_client, monkeypatch):
    """Admin deletion uses the resolved DB admin shape, not the raw auth dict."""
    target_id = "00000000-0000-0000-0000-000000000001"
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=_mock_user(id=target_id)))
    delete_user = MagicMock(return_value=True)
    monkeypatch.setattr(user_service, "delete_user", delete_user)

    resp = admin_client.delete(f"/users/{target_id}")

    assert resp.status_code == 204
    delete_user.assert_called_once()


# ── PATCH /users/{user_id}/role (admin-only, audit I16) ──────────────


def test_update_user_role_requires_auth(client):
    response = client.patch(
        "/users/00000000-0000-0000-0000-000000000000/role",
        json={"role": "admin"},
    )
    assert response.status_code == 401


def test_update_user_role_forbidden_for_non_admin(authenticated_client):
    resp = authenticated_client.patch(
        "/users/00000000-0000-0000-0000-000000000000/role",
        json={"role": "admin"},
    )
    assert resp.status_code == 403


def test_update_user_role_admin_promotes(admin_client, monkeypatch):
    """Admin can promote a user to admin via PATCH /users/{id}/role."""
    promoted = _mock_user(role="admin")
    monkeypatch.setattr(user_service, "set_role", MagicMock(return_value=promoted))

    resp = admin_client.patch(
        "/users/00000000-0000-0000-0000-000000000001/role",
        json={"role": "admin"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_update_user_role_rejects_invalid_role(admin_client):
    """Role not in {'user', 'admin'} is rejected by schema (422)."""
    resp = admin_client.patch(
        "/users/00000000-0000-0000-0000-000000000001/role",
        json={"role": "superuser"},
    )
    assert resp.status_code == 422


# ── Health check ─────────────────────────────────────────────────────


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
