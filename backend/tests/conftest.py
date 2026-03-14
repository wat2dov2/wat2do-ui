import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from main import app
from core.auth import get_current_user
from core.database import get_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def authenticated_client():
    """Client with auth dependency overridden to return a fake user."""
    async def fake_user():
        return {"id": "test-supabase-uid", "email": "test@example.com", "aud": "authenticated", "role": "authenticated"}

    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)
