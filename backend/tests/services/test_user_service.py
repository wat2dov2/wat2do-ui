import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from services.user_service import get_user


def test_get_user_not_found():
    with patch("services.user_service.get_sb") as mock_get_sb:
        mock_res = MagicMock()
        mock_res.data = []
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_res
        mock_get_sb.return_value = mock_sb

        user = get_user(uuid4())
        assert user is None
