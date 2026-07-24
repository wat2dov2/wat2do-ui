import uuid
from unittest.mock import MagicMock

from schemas.organization import OrganizationResponse
from schemas.organization_membership import (
    OrganizationMembershipResponse,
    OrganizationMembershipWithUserResponse,
)
from services import organization_membership_service, organization_service
from tests.conftest import FAKE_USER, OTHER_USER


def _mock_organization(**overrides) -> OrganizationResponse:
    defaults = {
        "id": 1,
        "organization_name": "Test Organization",
        "organization_type": "wusa",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


def _mock_membership(**overrides) -> OrganizationMembershipResponse:
    defaults = {
        "id": uuid.uuid4(),
        "organization_id": 1,
        "user_id": uuid.UUID(FAKE_USER["id"]),
        "status": "pending",
        "role": "member",
        "created_at": "2026-06-05T00:00:00Z",
        "updated_at": "2026-06-05T00:00:00Z",
    }
    defaults.update(overrides)
    return OrganizationMembershipResponse.model_validate(defaults)


def _mock_membership_with_user(**overrides) -> OrganizationMembershipWithUserResponse:
    defaults = {
        "id": uuid.uuid4(),
        "organization_id": 1,
        "user_id": uuid.UUID(FAKE_USER["id"]),
        "status": "pending",
        "role": "member",
        "created_at": "2026-06-05T00:00:00Z",
        "updated_at": "2026-06-05T00:00:00Z",
        "user": {
            "id": uuid.UUID(FAKE_USER["id"]),
            "email": FAKE_USER["email"],
            "full_name": "Fake User",
            "avatar_url": None,
        },
    }
    defaults.update(overrides)
    return OrganizationMembershipWithUserResponse.model_validate(defaults)


# --- Authentication & Basic Checks ---


def test_join_organization_requires_auth(client):
    response = client.post("/organizations/1/join")
    assert response.status_code == 401


def test_leave_organization_requires_auth(client):
    response = client.delete("/organizations/1/membership")
    assert response.status_code == 401


def test_list_members_requires_auth(client):
    response = client.get("/organizations/1/memberships")
    assert response.status_code == 401


# --- Join Request Flow ---


def test_request_to_join_organization_success(authenticated_client, monkeypatch):
    organization = _mock_organization()
    membership = _mock_membership()
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_membership_service,
        "create_membership_request",
        MagicMock(return_value=membership),
    )

    response = authenticated_client.post("/organizations/1/join")
    assert response.status_code == 201
    assert response.json()["status"] == "pending"


def test_request_to_join_nonexistent_organization(authenticated_client, monkeypatch):
    monkeypatch.setattr(organization_service, "get_organization", MagicMock(return_value=None))

    response = authenticated_client.post("/organizations/999/join")
    assert response.status_code == 404


# --- Leave / Cancel Request Flow ---


def test_leave_organization_success(authenticated_client, monkeypatch):
    organization = _mock_organization()
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_membership_service, "delete_membership", MagicMock(return_value=True)
    )

    response = authenticated_client.delete("/organizations/1/membership")
    assert response.status_code == 204


def test_leave_organization_not_member(authenticated_client, monkeypatch):
    organization = _mock_organization()
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_membership_service, "delete_membership", MagicMock(return_value=False)
    )

    response = authenticated_client.delete("/organizations/1/membership")
    assert response.status_code == 404


# --- Get Membership Status ---


def test_get_my_membership_status(authenticated_client, monkeypatch):
    organization = _mock_organization()
    membership = _mock_membership()
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_membership_service,
        "get_user_membership_status",
        MagicMock(return_value=membership),
    )

    response = authenticated_client.get("/organizations/1/membership")
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


# --- Admin Roster Management Flow ---


def test_list_organization_members_owner_allowed(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    memberships = [_mock_membership_with_user()]
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        organization_membership_service,
        "list_organization_memberships",
        MagicMock(return_value=memberships),
    )

    response = authenticated_client.get("/organizations/1/memberships")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_organization_members_non_owner_forbidden(other_user_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    response = other_user_client.get("/organizations/1/memberships")
    assert response.status_code == 403


def test_update_organization_membership_owner_allowed(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    membership = _mock_membership(status="approved")
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        organization_membership_service,
        "update_membership_status",
        MagicMock(return_value=membership),
    )

    response = authenticated_client.patch(
        f"/organizations/1/memberships/{OTHER_USER['id']}", json={"status": "approved"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_update_organization_membership_non_owner_forbidden(other_user_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    response = other_user_client.patch(
        f"/organizations/1/memberships/{OTHER_USER['id']}", json={"status": "approved"}
    )
    assert response.status_code == 403


def test_remove_organization_member_owner_allowed(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        organization_membership_service, "delete_membership", MagicMock(return_value=True)
    )

    response = authenticated_client.delete(f"/organizations/1/memberships/{OTHER_USER['id']}")
    assert response.status_code == 204


def test_remove_organization_member_non_owner_forbidden(other_user_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    response = other_user_client.delete(f"/organizations/1/memberships/{OTHER_USER['id']}")
    assert response.status_code == 403
