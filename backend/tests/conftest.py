import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_auth():
    with patch(
        "core.auth.get_current_user",
        return_value={"id": "test-user"},
    ):
        yield
