import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from main import app
from core.auth import get_current_user, get_admin_user

FAKE_USER = {
    "id": "test-supabase-uid",
    "email": "test@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}

OTHER_USER = {
    "id": "other-supabase-uid",
    "email": "other@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}

ADMIN_USER = {
    "id": "admin-supabase-uid",
    "email": "admin@example.com",
    "aud": "authenticated",
    "role": "authenticated",
}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def authenticated_client():
    """Client with auth dependency overridden to return a fake user."""
    def fake_user():
        return FAKE_USER

    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def other_user_client():
    """Client authenticated as a different (non-owner) user."""
    def fake_user():
        return OTHER_USER

    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def admin_client():
    """Client authenticated as an admin user."""
    def fake_user():
        return ADMIN_USER

    def fake_admin():
        return ADMIN_USER

    app.dependency_overrides[get_current_user] = fake_user
    app.dependency_overrides[get_admin_user] = fake_admin
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_admin_user, None)
