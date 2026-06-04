from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.auth import get_current_user
from core.constants import ROLE_ADMIN, ROLE_USER
from main import app
from schemas.user import UserResponse
from services import user_service

# In tests we make the auth id (Supabase ``sub``) and the internal
# ``users.id`` the **same** UUID per actor. In production they're
# different columns with different values, but making them equal in
# tests means a mock event whose ``created_by`` is set to
# ``FAKE_USER["id"]`` also passes the post-migration ownership check
# (``db_user.id == resource.created_by``). One value to remember per
# actor rather than two.
FAKE_USER = {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "test@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}

OTHER_USER = {
    "id": "22222222-2222-2222-2222-222222222222",
    "email": "other@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}

ADMIN_USER = {
    "id": "33333333-3333-3333-3333-333333333333",
    "email": "admin@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}


def make_db_user(
    auth_user: dict = FAKE_USER, *, role: str = ROLE_USER, **overrides
) -> UserResponse:
    """Build a ``UserResponse`` whose ``.id`` matches ``auth_user["id"]``.

    Default role is ``user``. Pass ``role=ROLE_ADMIN`` for admin tests.
    ``**overrides`` lets individual tests override any field (e.g. a
    different UUID for cross-user ownership scenarios).
    """
    now = datetime.now(timezone.utc)
    defaults = {
        "id": auth_user["id"],
        "email": auth_user["email"],
        "full_name": None,
        "avatar_url": None,
        "faculty": None,
        "school": None,
        "interests": None,
        "is_first_year": False,
        "role": role,
        "created_at": now,
        "updated_at": now,
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


def _install_db_user_mock(monkeypatch, db_user: UserResponse) -> MagicMock:
    """Make ``user_service.get_user_by_supabase_id`` return *db_user*.

    Returned as a ``MagicMock`` so tests can inspect call args if they
    want; most tests just need the lookup to succeed.
    """
    mock = MagicMock(return_value=db_user)
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", mock)
    return mock


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def authenticated_client(monkeypatch):
    """Client authenticated as a regular (non-admin) user.

    Installs both the JWT dependency override AND a matching
    ``user_service.get_user_by_supabase_id`` mock, so routes that reach
    for ``get_db_user`` / ``get_admin_user`` / ownership helpers resolve
    to a consistent ``UserResponse`` (``role=user``). Tests that need a
    different role or id can re-install their own mock with
    ``monkeypatch.setattr(...)`` — that will take precedence.
    """
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    _install_db_user_mock(monkeypatch, make_db_user(FAKE_USER))
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def other_user_client(monkeypatch):
    """Client authenticated as a different (non-owner, non-admin) user."""
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    _install_db_user_mock(monkeypatch, make_db_user(OTHER_USER))
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def admin_client(monkeypatch):
    """Client authenticated as an admin user."""
    app.dependency_overrides[get_current_user] = lambda: ADMIN_USER
    _install_db_user_mock(monkeypatch, make_db_user(ADMIN_USER, role=ROLE_ADMIN))
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)
