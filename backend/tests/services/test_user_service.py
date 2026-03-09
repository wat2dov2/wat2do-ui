import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from services.user_service import get_user, create_user
from schemas.user import UserCreate


@pytest.mark.asyncio
async def test_get_user_not_found():
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = None
    db.execute.return_value = result_mock

    user = await get_user(db, uuid4())
    assert user is None


@pytest.mark.asyncio
async def test_create_user():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    data = UserCreate(email="test@example.com", full_name="Test User")
    user = await create_user(db, data)

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once()
