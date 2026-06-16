from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.organization import OrganizationResponse
from schemas.user import UserResponse
from services import organization_service, saved_organization_service, user_service
from tests.conftest import FAKE_USER


def _mock_organization(**overrides) -> OrganizationResponse:
    defaults = {
        "id": 42,
        "organization_name": "Mock Organization",
        "organization_type": "Social",
        "categories": ["Games & Recreation"],
        "created_by": FAKE_USER["id"],
        "school": "University of Waterloo",
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


def _mock_db_user(**overrides) -> UserResponse:
    defaults = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": FAKE_USER["email"],
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /saved-organizations/ ──────────────────────────────────────────────


def test_list_saved_organizations_requires_auth(client):
    response = client.get("/saved-organizations/")
    assert response.status_code == 401


def test_list_saved_organizations_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(
        saved_organization_service, "get_saved_organization_ids", MagicMock(return_value=[1, 3, 7])
    )

    resp = authenticated_client.get("/saved-organizations/")
    assert resp.status_code == 200
    assert resp.json() == [1, 3, 7]


# ── PUT /saved-organizations/{organization_id} ────────────────────────────────────


def test_save_organization_requires_auth(client):
    response = client.put("/saved-organizations/42")
    assert response.status_code == 401


def test_save_organization_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=_mock_organization())
    )
    monkeypatch.setattr(
        saved_organization_service, "count_saved_organizations", MagicMock(return_value=0)
    )
    monkeypatch.setattr(
        saved_organization_service, "save_organization", MagicMock(return_value=None)
    )

    resp = authenticated_client.put("/saved-organizations/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"


def test_save_organization_nonexistent_returns_404(authenticated_client, monkeypatch):
    """PUT to /saved-organizations/{organization_id} returns 404 when the organization does not exist."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(organization_service, "get_organization", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-organizations/9999")
    assert resp.status_code == 404


def test_save_organization_at_cap_returns_400(authenticated_client, monkeypatch):
    """Saving a new organization when the user is at the cap returns 400."""
    from core.constants import MAX_SAVED_ORGANIZATIONS_PER_USER

    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=_mock_organization())
    )
    monkeypatch.setattr(
        saved_organization_service,
        "count_saved_organizations",
        MagicMock(return_value=MAX_SAVED_ORGANIZATIONS_PER_USER),
    )

    resp = authenticated_client.put("/saved-organizations/42")
    assert resp.status_code == 400


# ── DELETE /saved-organizations/{organization_id} ─────────────────────────────────


def test_unsave_organization_requires_auth(client):
    response = client.delete("/saved-organizations/42")
    assert response.status_code == 401


def test_unsave_organization_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(
        saved_organization_service, "unsave_organization", MagicMock(return_value=True)
    )

    resp = authenticated_client.delete("/saved-organizations/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unsaved"
