import pytest
from fastapi.testclient import TestClient

from main import app
from core.auth import get_current_user


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def authenticated_client():
    """Client with auth dependency overridden to return a fake user."""
    def fake_user():
        return {"id": "test-supabase-uid", "email": "test@example.com", "aud": "authenticated", "role": "authenticated"}

    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)
