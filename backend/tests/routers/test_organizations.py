from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

from schemas.organization import OrganizationMemberResponse, OrganizationResponse
from schemas.user import UserResponse
from services import organization_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_organization(**overrides) -> OrganizationResponse:
    defaults = {
        "id": 1,
        "organization_name": "Test Organization",
        "organization_type": "wusa",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return OrganizationResponse.model_validate(defaults)


def test_create_organization_requires_auth(client):
    response = client.post(
        "/organizations/",
        json={"organization_name": "Test Organization", "organization_type": "wusa"},
    )
    assert response.status_code == 401


def test_delete_organization_requires_auth(client):
    response = client.delete("/organizations/1")
    assert response.status_code == 401


def test_get_discord_integration_requires_auth(client):
    response = client.get("/organizations/1/integrations/discord")
    assert response.status_code == 401


def test_upsert_discord_integration_requires_auth(client):
    response = client.put(
        "/organizations/1/integrations/discord",
        json={
            "connected": True,
            "server_id": "1",
            "server_name": "Test Server",
            "channel_id": "101",
            "channel_name": "#events",
        },
    )
    assert response.status_code == 401


def test_get_slack_integration_requires_auth(client):
    response = client.get("/organizations/1/integrations/slack")
    assert response.status_code == 401


def test_upsert_instagram_integration_requires_auth(client):
    response = client.put(
        "/organizations/1/integrations/instagram",
        json={
            "connected": True,
            "name": "@testorganization",
            "metadata": {"handle": "testorganization"},
        },
    )
    assert response.status_code == 401


def test_create_organization_sets_current_user_as_owner(authenticated_client, monkeypatch):
    """Authenticated users create organizations owned by themselves."""
    created_organization = _mock_organization(created_by=FAKE_USER["id"])
    mock_create = MagicMock(return_value=created_organization)
    monkeypatch.setattr(organization_service, "create_organization", mock_create)

    resp = authenticated_client.post(
        "/organizations/",
        json={"organization_name": "Test Organization", "organization_type": "wusa"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_create_organization_sets_admin_as_owner_by_default(admin_client, monkeypatch):
    """Admin-created organizations default to the admin as owner if no owner is provided."""
    created_organization = _mock_organization()
    mock_create = MagicMock(return_value=created_organization)
    monkeypatch.setattr(organization_service, "create_organization", mock_create)

    resp = admin_client.post(
        "/organizations/",
        json={"organization_name": "Test Organization", "organization_type": "wusa"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == ADMIN_USER["id"]


def test_create_organization_rejects_client_supplied_owner(admin_client, monkeypatch):
    """Organization creation ownership is always derived from the authenticated user."""
    mock_create = MagicMock()
    monkeypatch.setattr(organization_service, "create_organization", mock_create)

    resp = admin_client.post(
        "/organizations/",
        json={
            "organization_name": "Test Organization",
            "organization_type": "wusa",
            "owner_user_id": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 422
    mock_create.assert_not_called()


def test_update_organization_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own organization."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "update_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    resp = authenticated_client.patch("/organizations/1", json={"organization_name": "Updated"})
    assert resp.status_code == 200


def test_update_organization_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )

    resp = other_user_client.patch("/organizations/1", json={"organization_name": "Hacked"})
    assert resp.status_code == 403


def test_delete_organization_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on delete."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )

    resp = other_user_client.delete("/organizations/1")
    assert resp.status_code == 403


def test_delete_organization_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own organization."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(organization_service, "delete_organization", MagicMock(return_value=True))
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    resp = authenticated_client.delete("/organizations/1")
    assert resp.status_code == 204


def test_integration_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot read/modify organization integrations."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )

    resp = other_user_client.get("/organizations/1/integrations/discord")
    assert resp.status_code == 403

    resp = other_user_client.put(
        "/organizations/1/integrations/discord",
        json={
            "connected": True,
            "name": "TestOrganization - #events",
            "metadata": {
                "server_id": "1",
                "server_name": "S",
                "channel_id": "101",
                "channel_name": "#e",
            },
        },
    )
    assert resp.status_code == 403

    resp = other_user_client.delete("/organizations/1/integrations/discord")
    assert resp.status_code == 403


def test_integration_owner_allowed(authenticated_client, monkeypatch):
    """Owner can read organization integrations."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        organization_service,
        "get_platform_integration",
        MagicMock(
            return_value={
                "organization_id": 1,
                "platform": "discord",
                "connected": False,
                "name": None,
                "last_sync": None,
                "metadata": {},
            }
        ),
    )

    resp = authenticated_client.get("/organizations/1/integrations/discord")
    assert resp.status_code == 200


def test_list_organization_members_requires_auth(client):
    resp = client.get("/organizations/1/members")
    assert resp.status_code == 401


def test_list_organization_members_allowed_for_member(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )

    mock_members = [
        OrganizationMemberResponse(
            user_id=UUID(FAKE_USER["id"]),
            email=FAKE_USER["email"],
            full_name=FAKE_USER.get("full_name"),
            avatar_url=FAKE_USER.get("avatar_url"),
            role="Member",
            joined_at=datetime.now(timezone.utc),
        )
    ]
    monkeypatch.setattr(
        organization_service, "list_organization_members", MagicMock(return_value=mock_members)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    resp = authenticated_client.get("/organizations/1/members")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == FAKE_USER["email"]


def test_list_organization_members_denied_for_non_member(other_user_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=False)
    )

    resp = other_user_client.get("/organizations/1/members")
    assert resp.status_code == 403


def test_add_organization_member_requires_auth(client):
    resp = client.post("/organizations/1/members", json={"email": "new@example.com"})
    assert resp.status_code == 401


def test_add_organization_member_allowed_for_member(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    from services import user_service

    new_user_id = "00000000-0000-0000-0000-000000000002"
    mock_user = UserResponse(
        id=UUID(new_user_id),
        email="new@example.com",
        full_name="New User",
        avatar_url=None,
        role="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=mock_user))

    mock_member_resp = OrganizationMemberResponse(
        user_id=UUID(new_user_id),
        email="new@example.com",
        full_name="New User",
        avatar_url=None,
        role="Member",
        joined_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(
        organization_service, "add_organization_member", MagicMock(return_value=mock_member_resp)
    )

    resp = authenticated_client.post("/organizations/1/members", json={"email": "new@example.com"})
    assert resp.status_code == 201
    assert resp.json()["email"] == "new@example.com"


def test_remove_organization_member_allowed_for_member(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    mock_remove = MagicMock(return_value=True)
    monkeypatch.setattr(organization_service, "remove_organization_member", mock_remove)

    target_user_id = OTHER_USER["id"]
    resp = authenticated_client.delete(f"/organizations/1/members/{target_user_id}")
    assert resp.status_code == 204
    assert mock_remove.call_count == 1


# --- Invitation Tests ---


def test_add_organization_member_invites_if_user_not_found(authenticated_client, monkeypatch):
    """If user not found, create a pending invitation and return 201."""
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    from services import user_service

    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))

    mock_invite = {
        "id": "11111111-1111-1111-1111-111111111111",
        "organization_id": 1,
        "email": "invitee@example.com",
        "token": "22222222-2222-2222-2222-222222222222",
        "invited_by": FAKE_USER["id"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc),
    }
    monkeypatch.setattr(
        organization_service, "create_invitation", MagicMock(return_value=mock_invite)
    )

    resp = authenticated_client.post(
        "/organizations/1/members", json={"email": "invitee@example.com"}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "invitee@example.com"
    assert data["status"] == "pending"


def test_list_invitations_requires_auth(client):
    resp = client.get("/organizations/1/invitations")
    assert resp.status_code == 401


def test_list_invitations_allowed_for_member(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )

    mock_invites = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": 1,
            "email": "invitee@example.com",
            "token": "22222222-2222-2222-2222-222222222222",
            "invited_by": FAKE_USER["id"],
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc),
        }
    ]
    monkeypatch.setattr(
        organization_service, "list_invitations", MagicMock(return_value=mock_invites)
    )

    resp = authenticated_client.get("/organizations/1/invitations")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == "invitee@example.com"


def test_revoke_invitation_allowed_for_member(authenticated_client, monkeypatch):
    organization = _mock_organization(created_by=FAKE_USER["id"])
    monkeypatch.setattr(
        organization_service, "get_organization", MagicMock(return_value=organization)
    )
    monkeypatch.setattr(
        organization_service, "is_organization_member", MagicMock(return_value=True)
    )
    monkeypatch.setattr(organization_service, "revoke_invitation", MagicMock(return_value=True))

    resp = authenticated_client.delete(
        "/organizations/1/invitations/11111111-1111-1111-1111-111111111111"
    )
    assert resp.status_code == 204


def test_get_invitation_by_token(client, monkeypatch):
    mock_invite_public = {
        "organization_name": "Test Organization",
        "email": "invitee@example.com",
        "expires_at": datetime.now(timezone.utc),
    }
    monkeypatch.setattr(
        organization_service, "get_invitation_by_token", MagicMock(return_value=mock_invite_public)
    )

    resp = client.get("/organizations/invitations/22222222-2222-2222-2222-222222222222")
    assert resp.status_code == 200
    data = resp.json()
    assert data["organization_name"] == "Test Organization"
    assert data["email"] == "invitee@example.com"


def test_accept_invitation(authenticated_client, monkeypatch):
    monkeypatch.setattr(organization_service, "accept_invitation", MagicMock(return_value=True))

    resp = authenticated_client.post(
        "/organizations/invitations/22222222-2222-2222-2222-222222222222/accept"
    )
    assert resp.status_code == 204
