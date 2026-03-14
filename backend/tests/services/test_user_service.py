import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from services.user_service import get_user


@pytest.mark.asyncio
async def test_get_user_not_found():
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = None
    db.execute.return_value = result_mock

    user = await get_user(db, uuid4())
    assert user is None
