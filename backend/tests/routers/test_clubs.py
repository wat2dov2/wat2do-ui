from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

from schemas.club import ClubMemberResponse, ClubResponse
from schemas.user import UserResponse
from services import club_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 1,
        "club_name": "Test Club",
        "club_type": "WUSA",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def test_create_club_requires_auth(client):
    response = client.post("/clubs/", json={"club_name": "Test Club", "club_type": "WUSA"})
    assert response.status_code == 401


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
        json={"connected": True, "name": "@testclub", "metadata": {"handle": "testclub"}},
    )
    assert response.status_code == 401


def test_create_club_forbidden_for_regular_user(authenticated_client, monkeypatch):
    """Only admins can approve/create clubs."""
    monkeypatch.setattr(club_service, "create_club", MagicMock())

    resp = authenticated_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "WUSA"},
    )
    assert resp.status_code == 403
    club_service.create_club.assert_not_called()


def test_create_club_sets_admin_as_owner_by_default(admin_client, monkeypatch):
    """Admin-created clubs default to the admin as owner if no owner is provided."""
    created_club = _mock_club()
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "WUSA"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == ADMIN_USER["id"]


def test_create_club_can_assign_approved_owner(admin_client, monkeypatch):
    """Admins can create an approved club for a specific user."""
    created_club = _mock_club(created_by=FAKE_USER["id"])
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={
            "club_name": "Test Club",
            "club_type": "WUSA",
            "owner_user_id": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_update_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "update_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    resp = authenticated_client.patch("/clubs/1", json={"club_name": "Updated"})
    assert resp.status_code == 200


def test_update_club_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.patch("/clubs/1", json={"club_name": "Hacked"})
    assert resp.status_code == 403


def test_delete_club_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on delete."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.delete("/clubs/1")
    assert resp.status_code == 403


def test_delete_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "delete_club", MagicMock(return_value=True))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))

    resp = authenticated_client.delete("/clubs/1")
    assert resp.status_code == 204


def test_integration_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot read/modify club integrations."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.get("/clubs/1/integrations/discord")
    assert resp.status_code == 403

    resp = other_user_client.put(
        "/clubs/1/integrations/discord",
        json={
            "connected": True,
            "name": "TestClub - #events",
            "metadata": {
                "server_id": "1",
                "server_name": "S",
                "channel_id": "101",
                "channel_name": "#e",
            },
        },
    )
    assert resp.status_code == 403

    resp = other_user_client.delete("/clubs/1/integrations/discord")
    assert resp.status_code == 403


def test_integration_owner_allowed(authenticated_client, monkeypatch):
    """Owner can read club integrations."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    monkeypatch.setattr(
        club_service,
        "get_platform_integration",
        MagicMock(
            return_value={
                "club_id": 1,
                "platform": "discord",
                "connected": False,
                "name": None,
                "last_sync": None,
                "metadata": {},
            }
        ),
    )

    resp = authenticated_client.get("/clubs/1/integrations/discord")
    assert resp.status_code == 200


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
