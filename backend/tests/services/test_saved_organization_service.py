"""Service-level tests for ``saved_organization_service``.

Verifies that the database client builder chain uses correct tables and filters.
"""

from uuid import uuid4

from core.tables import USER_SAVED_ORGANIZATIONS
from services.saved_organization_service import (
    count_saved_organizations,
    get_saved_organization_ids,
    unsave_organization,
)


def test_unsave_organization_filters_by_user_id_and_organization_id(fake_sb, patch_sb):
    """Both the user_id and organization_id filters must land on the delete chain."""
    patch_sb("services.saved_organization_service")
    fake_sb.set_response(data=[{"id": "row-uuid"}])
    user_id = str(uuid4())

    deleted = unsave_organization(user_id, 42)

    assert deleted is True
    fake_sb.table.assert_called_once_with(USER_SAVED_ORGANIZATIONS)
    fake_sb.delete.assert_called_once()
    fake_sb.eq.assert_any_call("user_id", user_id)
    fake_sb.eq.assert_any_call("organization_id", 42)


def test_get_saved_organization_ids_filters_by_user_id(fake_sb, patch_sb):
    """Read-side filter must also be ``user_id``."""
    patch_sb("services.saved_organization_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"organization_id": 1}, {"organization_id": 2}])

    ids = get_saved_organization_ids(user_id)

    assert ids == [1, 2]
    fake_sb.table.assert_called_with(USER_SAVED_ORGANIZATIONS)
    fake_sb.eq.assert_any_call("user_id", user_id)


def test_count_saved_organizations_returns_postgrest_count(fake_sb, patch_sb):
    """``count="exact"`` result propagates via ``r.count``, not ``r.data``."""
    patch_sb("services.saved_organization_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[], count=37)

    assert count_saved_organizations(user_id) == 37
    fake_sb.eq.assert_called_once_with("user_id", user_id)
