"""Service-level tests for ``saved_club_service``.

Verifies that the database client builder chain uses correct tables and filters.
"""

from uuid import uuid4

from core.tables import USER_SAVED_CLUBS
from services.saved_club_service import (
    count_saved_clubs,
    get_saved_club_ids,
    unsave_club,
)


def test_unsave_club_filters_by_user_id_and_club_id(fake_sb, patch_sb):
    """Both the user_id and club_id filters must land on the delete chain."""
    patch_sb("services.saved_club_service")
    fake_sb.set_response(data=[{"id": "row-uuid"}])
    user_id = str(uuid4())

    deleted = unsave_club(user_id, 42)

    assert deleted is True
    fake_sb.table.assert_called_once_with(USER_SAVED_CLUBS)
    fake_sb.delete.assert_called_once()
    fake_sb.eq.assert_any_call("user_id", user_id)
    fake_sb.eq.assert_any_call("club_id", 42)


def test_get_saved_club_ids_filters_by_user_id(fake_sb, patch_sb):
    """Read-side filter must also be ``user_id``."""
    patch_sb("services.saved_club_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"club_id": 1}, {"club_id": 2}])

    ids = get_saved_club_ids(user_id)

    assert ids == [1, 2]
    fake_sb.table.assert_called_with(USER_SAVED_CLUBS)
    fake_sb.eq.assert_any_call("user_id", user_id)


def test_count_saved_clubs_returns_postgrest_count(fake_sb, patch_sb):
    """``count="exact"`` result propagates via ``r.count``, not ``r.data``."""
    patch_sb("services.saved_club_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[], count=37)

    assert count_saved_clubs(user_id) == 37
    fake_sb.eq.assert_called_once_with("user_id", user_id)
