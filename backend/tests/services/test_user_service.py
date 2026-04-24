from uuid import uuid4

from core.tables import USERS
from services.user_service import get_user


def test_get_user_returns_none_when_no_row(fake_sb, patch_sb):
    """No rows back from Supabase → service returns ``None`` (not an error)."""
    patch_sb("services.user_service")
    fake_sb.set_response(data=[])

    assert get_user(uuid4()) is None


def test_get_user_queries_users_table_by_id(fake_sb, patch_sb):
    """Guards against filter-column drift (``.eq("id", ...)`` → ``.eq("uuid", ...)``)."""
    patch_sb("services.user_service")
    user_id = uuid4()
    fake_sb.set_response(data=[])

    get_user(user_id)

    fake_sb.table.assert_called_once_with(USERS)
    fake_sb.select.assert_called_once_with("*")
    fake_sb.eq.assert_called_once_with("id", str(user_id))
