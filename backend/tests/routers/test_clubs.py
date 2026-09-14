from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from schemas.club import ClubMemberResponse, ClubResponse
from schemas.user import UserResponse
from services import club_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 1,
        "club_name": "Test Club",
        "club_type": "wusa",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def test_create_club_requires_auth(client):
    response = client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "wusa"},
    )
    assert response.status_code == 401


def test_club_contract_has_no_organization_aliases(client):
    schema = client.app.openapi()
    assert "/clubs/" in schema["paths"]
    assert not any("organization" in path for path in schema["paths"])
    assert "ClubResponse" in schema["components"]["schemas"]
    assert not any("Organization" in name for name in schema["components"]["schemas"])
    properties = schema["components"]["schemas"]["ClubResponse"]["properties"]
    assert "club_name" in properties
    assert "organization_name" not in properties
    assert client.get("/organizations/").status_code == 404


def test_club_create_rejects_old_field_names(authenticated_client):
    response = authenticated_client.post(
        "/clubs/", json={"organization_name": "Old contract", "organization_type": "wusa"}
    )
    assert response.status_code == 422


def test_delete_club_requires_auth(client):
    response = client.delete("/clubs/1")
    assert response.status_code == 401


def test_get_discord_integration_requires_auth(client):
    response = client.get("/clubs/1/integrations/discord")
    assert response.status_code == 401


def test_upsert_discord_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/discord",
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
    response = client.get("/clubs/1/integrations/slack")
    assert response.status_code == 401


def test_upsert_instagram_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/instagram",
        json={
            "connected": True,
            "name": "@testclub",
            "metadata": {"handle": "testclub"},
        },
    )
    assert response.status_code == 401


def test_create_club_sets_current_user_as_owner(authenticated_client, monkeypatch):
    """Authenticated users create clubs owned by themselves."""
    created_club = _mock_club(created_by=FAKE_USER["id"])
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = authenticated_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "wusa"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_create_club_sets_admin_as_owner_by_default(admin_client, monkeypatch):
    """Admin-created clubs default to the admin as owner if no owner is provided."""
    created_club = _mock_club()
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "wusa"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == ADMIN_USER["id"]


def test_create_club_rejects_client_supplied_owner(admin_client, monkeypatch):
    """Club creation ownership is always derived from the authenticated user."""
    mock_create = MagicMock()
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={
            "club_name": "Test Club",
            "club_type": "wusa",
            "owner_user_id": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 422
    mock_create.assert_not_called()


def test_update_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "update_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    resp = authenticated_client.patch("/clubs/1", json={"club_name": "Updated"})
    assert resp.status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "payload", "action"),
    [
        ("PATCH", "/clubs/1", {"club_name": "Changed"}, "update_club"),
        ("DELETE", "/clubs/1", None, "delete_club"),
        ("GET", "/clubs/1/integrations/discord", None, "get_platform_integration"),
        (
            "PUT",
            "/clubs/1/integrations/discord",
            {"connected": True, "name": "Test Club", "metadata": {"channel_id": "101"}},
            "upsert_platform_integration",
        ),
        ("DELETE", "/clubs/1/integrations/discord", None, "disconnect_platform_integration"),
    ],
)
def test_club_management_requires_membership(
    other_user_client, monkeypatch, method, path, payload, action
):
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=_mock_club()))
    membership = MagicMock(return_value=False)
    monkeypatch.setattr(club_service, "is_club_member", membership)
    operation = MagicMock()
    monkeypatch.setattr(club_service, action, operation)

    response = other_user_client.request(method, path, json=payload)

    assert response.status_code == 403
    membership.assert_called_once_with(1, OTHER_USER["id"])
    operation.assert_not_called()


def test_delete_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "delete_club", MagicMock(return_value=True))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    resp = authenticated_client.delete("/clubs/1")
    assert resp.status_code == 204


@pytest.mark.parametrize("platform", ["discord", "slack", "telegram"])
@pytest.mark.parametrize(
    "method,action",
    [("GET", "get_platform_integration"), ("DELETE", "disconnect_platform_integration")],
)
def test_integration_owner_allowed(authenticated_client, monkeypatch, platform, method, action):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    operation = MagicMock(return_value=club_service._empty_integration_response(1, platform))
    monkeypatch.setattr(club_service, action, operation)

    response = authenticated_client.request(method, f"/clubs/1/integrations/{platform}")

    assert response.status_code == 200
    assert response.json() == {
        "club_id": 1,
        "platform": platform,
        "connected": False,
        "name": None,
        "last_sync": None,
        "metadata": {},
    }
    operation.assert_called_once_with(1, platform)


def test_list_club_members_requires_auth(client):
    resp = client.get("/clubs/1/members")
    assert resp.status_code == 401


def test_list_club_members_allowed_for_member(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    mock_members = [
        ClubMemberResponse(
            user_id=UUID(FAKE_USER["id"]),
            email=FAKE_USER["email"],
            full_name=FAKE_USER.get("full_name"),
            avatar_url=FAKE_USER.get("avatar_url"),
            role="Member",
            joined_at=datetime.now(timezone.utc),
        )
    ]
    monkeypatch.setattr(club_service, "list_club_members", MagicMock(return_value=mock_members))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    resp = authenticated_client.get("/clubs/1/members")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == FAKE_USER["email"]


def test_list_club_members_denied_for_non_member(other_user_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=False))

    resp = other_user_client.get("/clubs/1/members")
    assert resp.status_code == 403


def test_add_club_member_requires_auth(client):
    resp = client.post("/clubs/1/members", json={"email": "new@example.com"})
    assert resp.status_code == 401


def test_add_club_member_allowed_for_member(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

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

    mock_member_resp = ClubMemberResponse(
        user_id=UUID(new_user_id),
        email="new@example.com",
        full_name="New User",
        avatar_url=None,
        role="Member",
        joined_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(club_service, "add_club_member", MagicMock(return_value=mock_member_resp))

    resp = authenticated_client.post("/clubs/1/members", json={"email": "new@example.com"})
    assert resp.status_code == 201
    assert resp.json()["email"] == "new@example.com"


def test_remove_club_member_allowed_for_member(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    mock_remove = MagicMock(return_value=True)
    monkeypatch.setattr(club_service, "remove_club_member", mock_remove)

    target_user_id = OTHER_USER["id"]
    resp = authenticated_client.delete(f"/clubs/1/members/{target_user_id}")
    assert resp.status_code == 204
    assert mock_remove.call_count == 1


# --- Invitation Tests ---


def test_add_club_member_invites_if_user_not_found(authenticated_client, monkeypatch):
    """If user not found, create a pending invitation and return 201."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    from services import user_service

    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))

    mock_invite = {
        "id": "11111111-1111-1111-1111-111111111111",
        "club_id": 1,
        "email": "invitee@example.com",
        "token": "22222222-2222-2222-2222-222222222222",
        "invited_by": FAKE_USER["id"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc),
    }
    monkeypatch.setattr(club_service, "create_invitation", MagicMock(return_value=mock_invite))

    resp = authenticated_client.post("/clubs/1/members", json={"email": "invitee@example.com"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "invitee@example.com"
    assert data["status"] == "pending"


def test_list_invitations_requires_auth(client):
    resp = client.get("/clubs/1/invitations")
    assert resp.status_code == 401


def test_list_invitations_allowed_for_member(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    mock_invites = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "club_id": 1,
            "email": "invitee@example.com",
            "token": "22222222-2222-2222-2222-222222222222",
            "invited_by": FAKE_USER["id"],
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc),
        }
    ]
    monkeypatch.setattr(club_service, "list_invitations", MagicMock(return_value=mock_invites))

    resp = authenticated_client.get("/clubs/1/invitations")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == "invitee@example.com"


def test_revoke_invitation_allowed_for_member(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    monkeypatch.setattr(club_service, "revoke_invitation", MagicMock(return_value=True))

    resp = authenticated_client.delete("/clubs/1/invitations/11111111-1111-1111-1111-111111111111")
    assert resp.status_code == 204


def test_get_invitation_by_token(client, monkeypatch):
    mock_invite_public = {
        "club_name": "Test Club",
        "email": "invitee@example.com",
        "expires_at": datetime.now(timezone.utc),
    }
    monkeypatch.setattr(
        club_service, "get_invitation_by_token", MagicMock(return_value=mock_invite_public)
    )

    resp = client.get("/clubs/invitations/22222222-2222-2222-2222-222222222222")
    assert resp.status_code == 200
    data = resp.json()
    assert data["club_name"] == "Test Club"
    assert data["email"] == "invitee@example.com"


def test_accept_invitation(authenticated_client, monkeypatch):
    monkeypatch.setattr(club_service, "accept_invitation", MagicMock(return_value=True))

    resp = authenticated_client.post(
        "/clubs/invitations/22222222-2222-2222-2222-222222222222/accept"
    )
    assert resp.status_code == 204


def test_create_club_from_normal_user_requires_review(authenticated_client, monkeypatch):
    """Non-admin submissions enter the review queue instead of going live."""
    mock_create = MagicMock(return_value=_mock_club(status="pending"))
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = authenticated_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "wusa"},
    )

    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert kwargs["auto_approve"] is False


def test_create_club_from_admin_is_auto_approved(admin_client, monkeypatch):
    """Admins publish clubs directly."""
    mock_create = MagicMock(return_value=_mock_club(status="approved"))
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "wusa"},
    )

    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert kwargs["auto_approve"] is True


def test_review_club_requires_admin(authenticated_client):
    resp = authenticated_client.post("/clubs/1/review", params={"club_status": "approved"})
    assert resp.status_code == 403


def test_review_club_approves(admin_client, monkeypatch):
    mock_set_status = MagicMock(return_value=_mock_club(status="approved"))
    monkeypatch.setattr(club_service, "set_club_status", mock_set_status)

    resp = admin_client.post("/clubs/1/review", params={"club_status": "approved"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    mock_set_status.assert_called_once_with(1, "approved")


def test_club_review_queue_requires_admin(authenticated_client):
    assert authenticated_client.get("/clubs/review").status_code == 403
